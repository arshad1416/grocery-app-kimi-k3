/**
 * Google Assistant Webhook Handler — GroceryApp (E2EE Version)
 *
 * Designed for deployment on Google Cloud Functions (Node.js).
 * Receives intents from Dialogflow (Google Assistant custom conversational action)
 * and interacts with the Zero-Knowledge Relay.
 */

const Y = require('yjs');
const crypto = require('crypto');

// ─── Configuration ───────────────────────────────────────────────────────────

const RELAY_BASE_URL = process.env.RELAY_BASE_URL || 'https://relay.groceryapp.local';
const API_TIMEOUT = 5000;

// ─── Cryptographic Helpers ───────────────────────────────────────────────────

/**
 * Decrypt the family master key using the assistant's RSA private key.
 */
function decryptFamilyKey(encryptedFamilyKeyB64) {
  const privateKeyPem = process.env.ASSISTANT_PRIVATE_KEY;
  if (!privateKeyPem) {
    throw new Error('Assistant private key not configured on Cloud Function (ASSISTANT_PRIVATE_KEY)');
  }
  
  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedFamilyKeyB64, 'base64')
  );
}

/**
 * Derive the sync key from the family master key using libsodium's KDF.
 */
async function getSyncKey(familyMasterKey) {
  const sodium = require('libsodium-wrappers');
  await sodium.ready;
  return sodium.crypto_kdf_derive_from_key(
    32, // KEY_LENGTH_BYTES
    0,  // subKeyIndex
    'yjs-sync',
    familyMasterKey
  );
}

/**
 * Decrypt an encrypted Yjs update using listId as AAD (Additional Authenticated Data).
 */
async function decryptUpdate(encryptedUpdate, listId, syncKey) {
  const sodium = require('libsodium-wrappers');
  await sodium.ready;
  
  const nonce = sodium.from_base64(encryptedUpdate.iv);
  const tag = sodium.from_base64(encryptedUpdate.tag);
  const ciphertext = sodium.from_base64(encryptedUpdate.ciphertext);

  const cipherWithTag = new Uint8Array(ciphertext.length + tag.length);
  cipherWithTag.set(ciphertext);
  cipherWithTag.set(tag, ciphertext.length);

  const additionalData = new TextEncoder().encode(listId);

  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    cipherWithTag,
    additionalData,
    nonce,
    syncKey
  );
}

/**
 * Encrypt a raw Yjs update using listId as AAD.
 */
async function encryptUpdate(updateUint8Array, listId, syncKey) {
  const sodium = require('libsodium-wrappers');
  await sodium.ready;
  
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const additionalData = new TextEncoder().encode(listId);

  const cipherWithTag = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    updateUint8Array,
    additionalData,
    null,
    nonce,
    syncKey
  );

  const abytes = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;
  const ciphertext = cipherWithTag.slice(0, cipherWithTag.length - abytes);
  const tag = cipherWithTag.slice(cipherWithTag.length - abytes);

  return {
    ciphertext: sodium.to_base64(ciphertext),
    iv: sodium.to_base64(nonce),
    tag: sodium.to_base64(tag)
  };
}

// ─── HTTP Helper: Call relay server ──────────────────────────────────────────

async function callRelay(endpoint, method, payload, accessToken) {
  const https = require('https');
  const http = require('http');
  const transport = RELAY_BASE_URL.startsWith('https') ? https : http;

  return new Promise((resolve, reject) => {
    const url = new URL(`${RELAY_BASE_URL}${endpoint}`);
    const data = payload ? JSON.stringify(payload) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      timeout: API_TIMEOUT,
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ success: false, error: 'Invalid response format' });
        }
      });
    });

    req.on('error', (err) =>
      reject(new Error(`Relay call failed: ${err.message}`)),
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Relay call timed out'));
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

// ─── Yjs List Resolution ─────────────────────────────────────────────────────

async function getActiveList(listData, syncKey) {
  let activeListId = null;
  let activeDoc = null;

  if (!listData.updates) {
    return { activeListId, activeDoc };
  }

  for (const [listId, updates] of Object.entries(listData.updates)) {
    const doc = new Y.Doc();
    for (const update of updates) {
      try {
        const decrypted = await decryptUpdate(update, listId, syncKey);
        Y.applyUpdate(doc, decrypted);
      } catch (err) {
        console.error(`Failed to decrypt update for list ${listId}:`, err.message);
      }
    }

    const meta = doc.getMap('meta');
    const isActive = meta.get('isActive');
    const isDeleted = meta.get('isDeleted');

    if (isActive && !isDeleted) {
      activeListId = listId;
      activeDoc = doc;
      break;
    }
  }

  return { activeListId, activeDoc };
}

function createNewListDoc(familyId) {
  const doc = new Y.Doc();
  const listId = 'list_' + Math.random().toString(36).substring(2, 11);
  
  doc.transact(() => {
    const meta = doc.getMap('meta');
    meta.set('id', listId);
    meta.set('familyId', familyId);
    meta.set('name', 'Groceries');
    meta.set('isActive', true);
    meta.set('isDeleted', false);
    meta.set('version', 1);
    meta.set('createdAt', Date.now());
    meta.set('updatedAt', Date.now());
  });
  
  return { listId, doc };
}

// ─── Intent Fulfillment Logic ───────────────────────────────────────────────

async function handleAddItem(parameters, listData, syncKey, accessToken) {
  const itemName = parameters.ItemName;
  const quantity = parseInt(parameters.Quantity, 10) || 1;
  const unit = parameters.Unit || 'each';

  if (!itemName) {
    return "I didn't catch the item name. What would you like to add?";
  }

  let { activeListId, activeDoc } = await getActiveList(listData, syncKey);
  let listId = activeListId;
  let doc = activeDoc;

  if (!listId) {
    const newList = createNewListDoc(listData.familyId || 'family');
    listId = newList.listId;
    doc = newList.doc;
  }

  const itemsArr = doc.getArray('items');
  let existingItem = null;
  for (let i = 0; i < itemsArr.length; i++) {
    const yItem = itemsArr.get(i);
    if (
      yItem.get('name')?.toLowerCase() === itemName.toLowerCase() &&
      !yItem.get('isDeleted') &&
      !yItem.get('isChecked')
    ) {
      existingItem = yItem;
      break;
    }
  }

  doc.transact(() => {
    if (existingItem) {
      const currentQty = existingItem.get('quantity') || 0;
      existingItem.set('quantity', currentQty + quantity);
      existingItem.set('updatedAt', Date.now());
      existingItem.set('version', (existingItem.get('version') || 1) + 1);
    } else {
      const yItem = new Y.Map();
      const itemId = 'item_' + Math.random().toString(36).substring(2, 11);
      yItem.set('id', itemId);
      yItem.set('listId', listId);
      yItem.set('familyId', listData.familyId || 'family');
      yItem.set('name', itemName);
      yItem.set('quantity', quantity);
      yItem.set('unit', unit);
      yItem.set('category', 'other');
      yItem.set('isChecked', false);
      yItem.set('isDeleted', false);
      yItem.set('version', 1);
      yItem.set('createdAt', Date.now());
      yItem.set('updatedAt', Date.now());
      yItem.set('sortOrder', itemsArr.length);
      itemsArr.push([yItem]);
    }

    const meta = doc.getMap('meta');
    meta.set('version', (meta.get('version') || 1) + 1);
    meta.set('updatedAt', Date.now());
  });

  const stateUpdate = Y.encodeStateAsUpdate(doc);
  const encrypted = await encryptUpdate(stateUpdate, listId, syncKey);

  await callRelay('/api/assistant/submit-update', 'POST', {
    listId,
    payload: encrypted
  }, accessToken);

  const quantityText = quantity > 1 ? `${quantity} ${unit} of ` : '';
  return `Added ${quantityText}${itemName} to your list.`;
}

async function handleGetList(listData, syncKey) {
  const { activeDoc } = await getActiveList(listData, syncKey);
  if (!activeDoc) {
    return 'Your grocery list is empty.';
  }

  const itemsArr = activeDoc.getArray('items');
  const items = [];
  for (let i = 0; i < itemsArr.length; i++) {
    const yItem = itemsArr.get(i);
    if (!yItem.get('isDeleted') && !yItem.get('isChecked')) {
      items.push({
        name: yItem.get('name'),
        quantity: yItem.get('quantity') || 1,
        unit: yItem.get('unit') || 'each'
      });
    }
  }

  if (items.length === 0) {
    return 'Your grocery list is empty.';
  }

  const itemList = items
    .slice(0, 10)
    .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
    .join(', ');
  
  return `Your grocery list has ${items.length} items: ${itemList}.`;
}

async function handleCheckOff(parameters, listData, syncKey, accessToken) {
  const itemName = parameters.ItemName;
  if (!itemName) {
    return 'Which item would you like to check off?';
  }

  const { activeListId, activeDoc } = await getActiveList(listData, syncKey);
  if (!activeDoc) {
    return `Sorry, I couldn't find ${itemName} on your list.`;
  }

  const itemsArr = activeDoc.getArray('items');
  let targetItem = null;
  for (let i = 0; i < itemsArr.length; i++) {
    const yItem = itemsArr.get(i);
    if (
      yItem.get('name')?.toLowerCase() === itemName.toLowerCase() &&
      !yItem.get('isDeleted') &&
      !yItem.get('isChecked')
    ) {
      targetItem = yItem;
      break;
    }
  }

  if (!targetItem) {
    return `Sorry, I couldn't find ${itemName} on your list.`;
  }

  activeDoc.transact(() => {
    targetItem.set('isChecked', true);
    targetItem.set('updatedAt', Date.now());
    targetItem.set('version', (targetItem.get('version') || 1) + 1);

    const meta = activeDoc.getMap('meta');
    meta.set('version', (meta.get('version') || 1) + 1);
    meta.set('updatedAt', Date.now());
  });

  const stateUpdate = Y.encodeStateAsUpdate(activeDoc);
  const encrypted = await encryptUpdate(stateUpdate, activeListId, syncKey);

  await callRelay('/api/assistant/submit-update', 'POST', {
    listId: activeListId,
    payload: encrypted
  }, accessToken);

  return `Marked ${itemName} as done.`;
}

// ─── Main Express/Cloud Function Entry Point ───────────────────────────────

exports.fulfillment = async (req, res) => {
  try {
    // 1. Authenticate Request
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing account linking Bearer token' });
    }
    const accessToken = authHeader.slice('Bearer '.length).trim();

    // 2. Extract Dialogflow intent and parameters
    const body = req.body;
    const intentName = body.queryResult && body.queryResult.intent && body.queryResult.intent.displayName;
    const parameters = (body.queryResult && body.queryResult.parameters) || {};

    if (!intentName) {
      return res.status(400).json({ error: 'Malformed request body: no intentName found' });
    }

    // 3. Fetch E2EE list data from relay
    const listData = await callRelay('/api/assistant/list-data', 'GET', null, accessToken);
    if (listData.error || !listData.encryptedMasterKey) {
      console.error('[GoogleAssistant] Config error:', listData.error);
      return res.json({
        fulfillmentText: 'Sorry, your family account is not correctly configured.'
      });
    }

    // 4. Decrypt keys
    const masterKey = decryptFamilyKey(listData.encryptedMasterKey);
    const syncKey = await getSyncKey(masterKey);

    // 5. Route to handler
    let speechResponse = '';
    if (intentName === 'AddItemIntent') {
      speechResponse = await handleAddItem(parameters, listData, syncKey, accessToken);
    } else if (intentName === 'GetListIntent') {
      speechResponse = await handleGetList(listData, syncKey);
    } else if (intentName === 'CheckOffIntent') {
      speechResponse = await handleCheckOff(parameters, listData, syncKey, accessToken);
    } else {
      speechResponse = "Sorry, I don't know how to handle that intent.";
    }

    // 6. Return response to Dialogflow
    return res.json({
      fulfillmentText: speechResponse,
      fulfillmentMessages: [
        {
          text: {
            text: [speechResponse]
          }
        }
      ]
    });
  } catch (err) {
    console.error('[GoogleAssistant] Error in fulfillment webhook:', err);
    return res.json({
      fulfillmentText: 'Sorry, I encountered an error. Please try again.'
    });
  }
};
