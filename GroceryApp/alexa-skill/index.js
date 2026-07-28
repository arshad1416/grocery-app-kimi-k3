/**
 * Alexa Skill Lambda Handler — GroceryApp (E2EE Version)
 *
 * Handles voice commands by:
 *   1. Fetching encrypted Yjs updates & encrypted family key from Zero-Knowledge Relay.
 *   2. Decrypting the family key with the Assistant's RSA Private Key (loaded from env).
 *   3. Deriving the Yjs Sync Key using libsodium KDF.
 *   4. Decrypting Yjs updates and loading lists.
 *   5. Modifying items locally in the decrypted Y.Doc.
 *   6. Re-encrypting the Yjs update and submitting to the Relay.
 */

const Alexa = require('ask-sdk');
const Y = require('yjs');
const crypto = require('crypto');

// ─── Configuration ───────────────────────────────────────────────────────────

const RELAY_BASE_URL = process.env.RELAY_BASE_URL || 'https://relay.groceryapp.local';
const API_TIMEOUT = 5000; // 5 seconds

// ─── Cryptographic Helpers ───────────────────────────────────────────────────

/**
 * Decrypt the family master key using the assistant's RSA private key.
 */
function decryptFamilyKey(encryptedFamilyKeyB64) {
  const privateKeyPem = process.env.ASSISTANT_PRIVATE_KEY;
  if (!privateKeyPem) {
    throw new Error('Assistant private key not configured on Lambda environment (ASSISTANT_PRIVATE_KEY)');
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

    const req = https.request(options, (res) => {
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
  let activeMeta = null;

  if (!listData.updates) {
    return { activeListId, activeDoc, activeMeta };
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
      activeMeta = meta;
      break;
    }
  }

  return { activeListId, activeDoc, activeMeta };
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

// ─── Intent Handlers ─────────────────────────────────────────────────────────

const AddItemIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddItemIntent'
    );
  },
  async handle(handlerInput) {
    const { requestEnvelope } = handlerInput;
    const slots = requestEnvelope.request.intent.slots;
    const accessToken = requestEnvelope.context.System.user.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak('Please link your GroceryApp account in the Alexa app to use this skill.')
        .withLinkAccountCard()
        .getResponse();
    }

    const itemName = slots.ItemName && slots.ItemName.value;
    const quantity = slots.Quantity ? parseInt(slots.Quantity.value, 10) || 1 : 1;
    const unit = slots.Unit ? slots.Unit.value : 'each';

    if (!itemName) {
      return handlerInput.responseBuilder
        .speak("I didn't catch what you want to add. Please try again.")
        .reprompt('What item would you like to add to your grocery list?')
        .getResponse();
    }

    try {
      // 1. Fetch encrypted list data
      const listData = await callRelay('/api/assistant/list-data', 'GET', null, accessToken);
      if (listData.error || !listData.encryptedMasterKey) {
        console.error('[Alexa:AddItemIntent] Config error:', listData.error);
        return handlerInput.responseBuilder
          .speak('Sorry, your family account is not correctly configured.')
          .getResponse();
      }

      // 2. Decrypt family key and get sync key
      const masterKey = decryptFamilyKey(listData.encryptedMasterKey);
      const syncKey = await getSyncKey(masterKey);

      // 3. Resolve active list
      let { activeListId, activeDoc } = await getActiveList(listData, syncKey);
      let listId = activeListId;
      let doc = activeDoc;

      if (!listId) {
        const newList = createNewListDoc(listData.familyId || 'family');
        listId = newList.listId;
        doc = newList.doc;
      }

      // 4. Update item in Yjs document
      const itemsArr = doc.getArray('items');
      let existingItem = null;
      for (let i = 0; i < itemsArr.length; i++) {
        const yItem = itemsArr.get(i);
        const name = yItem.get('name');
        const isDeleted = yItem.get('isDeleted');
        const isChecked = yItem.get('isChecked');
        if (name && name.toLowerCase() === itemName.toLowerCase() && !isDeleted && !isChecked) {
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
          yItem.set('deletedAt', null);
          yItem.set('version', 1);
          yItem.set('createdAt', Date.now());
          yItem.set('updatedAt', Date.now());
          yItem.set('sortOrder', itemsArr.length);
          itemsArr.push([yItem]);
        }

        // Bump list version
        const meta = doc.getMap('meta');
        meta.set('version', (meta.get('version') || 1) + 1);
        meta.set('updatedAt', Date.now());
      });

      // 5. Generate and encrypt update
      const stateUpdate = Y.encodeStateAsUpdate(doc);
      const encrypted = await encryptUpdate(stateUpdate, listId, syncKey);

      // 6. Submit back to relay
      await callRelay('/api/assistant/submit-update', 'POST', {
        listId,
        payload: encrypted
      }, accessToken);

      const quantityText = quantity > 1 ? `${quantity} ${unit}` : '';
      const speech = quantityText
        ? `Added ${quantityText} of ${itemName} to your grocery list.`
        : `Added ${itemName} to your grocery list.`;

      return handlerInput.responseBuilder
        .speak(speech)
        .withSimpleCard('GroceryApp', speech)
        .getResponse();
    } catch (err) {
      console.error('[Alexa:AddItemIntent] Error:', err.message);
      return handlerInput.responseBuilder
        .speak('Sorry, I had trouble adding that item. Please try again later.')
        .getResponse();
    }
  },
};

const GetListIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetListIntent'
    );
  },
  async handle(handlerInput) {
    const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak('Please link your GroceryApp account in the Alexa app.')
        .withLinkAccountCard()
        .getResponse();
    }

    try {
      // 1. Fetch encrypted list data
      const listData = await callRelay('/api/assistant/list-data', 'GET', null, accessToken);
      if (listData.error || !listData.encryptedMasterKey) {
        console.error('[Alexa:GetListIntent] Config error:', listData.error);
        return handlerInput.responseBuilder
          .speak('Sorry, your family account is not correctly configured.')
          .getResponse();
      }

      // 2. Decrypt key
      const masterKey = decryptFamilyKey(listData.encryptedMasterKey);
      const syncKey = await getSyncKey(masterKey);

      // 3. Resolve active list
      const { activeDoc } = await getActiveList(listData, syncKey);
      if (!activeDoc) {
        return handlerInput.responseBuilder
          .speak('Your grocery list is empty.')
          .getResponse();
      }

      // 4. Extract unchecked items
      const itemsArr = activeDoc.getArray('items');
      const items = [];
      for (let i = 0; i < itemsArr.length; i++) {
        const yItem = itemsArr.get(i);
        const isDeleted = yItem.get('isDeleted');
        const isChecked = yItem.get('isChecked');
        if (!isDeleted && !isChecked) {
          items.push({
            name: yItem.get('name'),
            quantity: yItem.get('quantity') || 1,
            unit: yItem.get('unit') || 'each'
          });
        }
      }

      if (items.length === 0) {
        return handlerInput.responseBuilder
          .speak('Your grocery list is empty.')
          .getResponse();
      }

      const speakItems = items.slice(0, 10); // Alexa read limit
      const itemList = speakItems
        .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
        .join(', ');
      const speech = `Your grocery list has ${items.length} items: ${itemList}.`;

      return handlerInput.responseBuilder.speak(speech).getResponse();
    } catch (err) {
      console.error('[Alexa:GetListIntent] Error:', err.message);
      return handlerInput.responseBuilder
        .speak('Sorry, I had trouble retrieving your list.')
        .getResponse();
    }
  },
};

const CheckOffIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'CheckOffIntent'
    );
  },
  async handle(handlerInput) {
    const slots = handlerInput.requestEnvelope.request.intent.slots;
    const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak('Please link your GroceryApp account in the Alexa app.')
        .withLinkAccountCard()
        .getResponse();
    }

    const itemName = slots.ItemName && slots.ItemName.value;

    if (!itemName) {
      return handlerInput.responseBuilder
        .speak("Which item would you like to check off?")
        .reprompt('Tell me the item name to check off.')
        .getResponse();
    }

    try {
      // 1. Fetch encrypted list data
      const listData = await callRelay('/api/assistant/list-data', 'GET', null, accessToken);
      if (listData.error || !listData.encryptedMasterKey) {
        console.error('[Alexa:CheckOffIntent] Config error:', listData.error);
        return handlerInput.responseBuilder
          .speak('Sorry, your family account is not correctly configured.')
          .getResponse();
      }

      // 2. Decrypt key
      const masterKey = decryptFamilyKey(listData.encryptedMasterKey);
      const syncKey = await getSyncKey(masterKey);

      // 3. Resolve active list
      const { activeListId, activeDoc } = await getActiveList(listData, syncKey);
      if (!activeDoc) {
        return handlerInput.responseBuilder
          .speak(`Sorry, I couldn't find ${itemName} on your list.`)
          .getResponse();
      }

      // 4. Find the item to check off
      const itemsArr = activeDoc.getArray('items');
      let targetItem = null;
      for (let i = 0; i < itemsArr.length; i++) {
        const yItem = itemsArr.get(i);
        const name = yItem.get('name');
        const isDeleted = yItem.get('isDeleted');
        const isChecked = yItem.get('isChecked');
        if (name && name.toLowerCase() === itemName.toLowerCase() && !isDeleted && !isChecked) {
          targetItem = yItem;
          break;
        }
      }

      if (!targetItem) {
        return handlerInput.responseBuilder
          .speak(`Sorry, I couldn't find ${itemName} on your list.`)
          .getResponse();
      }

      // 5. Update the Yjs document
      activeDoc.transact(() => {
        targetItem.set('isChecked', true);
        targetItem.set('updatedAt', Date.now());
        targetItem.set('version', (targetItem.get('version') || 1) + 1);

        // Bump list version
        const meta = activeDoc.getMap('meta');
        meta.set('version', (meta.get('version') || 1) + 1);
        meta.set('updatedAt', Date.now());
      });

      // 6. Generate and encrypt update
      const stateUpdate = Y.encodeStateAsUpdate(activeDoc);
      const encrypted = await encryptUpdate(stateUpdate, activeListId, syncKey);

      // 7. Submit update
      await callRelay('/api/assistant/submit-update', 'POST', {
        listId: activeListId,
        payload: encrypted
      }, accessToken);

      return handlerInput.responseBuilder
        .speak(`Marked ${itemName} as done.`)
        .getResponse();
    } catch (err) {
      console.error('[Alexa:CheckOffIntent] Error:', err.message);
      return handlerInput.responseBuilder
        .speak(`Sorry, I couldn't check off that item.`)
        .getResponse();
    }
  },
};

// ─── Built-in Handlers ───────────────────────────────────────────────────────

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(
        'Welcome to GroceryApp. You can say add an item, read my list, or check off an item. What would you like to do?',
      )
      .reprompt('You can say add milk to my grocery list, or say read my list.')
      .getResponse();
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(
        'You can add items by saying something like "add milk to my grocery list", ' +
        '"add a dozen eggs", or "add 2 litres of milk". You can also say "what\'s on my list" ' +
        'to hear your items, or "mark eggs as done" to check something off.',
      )
      .reprompt('How can I help you with your grocery list?')
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent' ||
        Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent')
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Goodbye! Happy grocery shopping.')
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest'
    );
  },
  handle(handlerInput) {
    console.log(
      `Session ended: ${JSON.stringify(handlerInput.requestEnvelope.request.reason)}`,
    );
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error(`[Alexa] Error: ${error.message}`);
    return handlerInput.responseBuilder
      .speak('Sorry, I encountered an error. Please try again.')
      .getResponse();
  },
};

// ─── Lambda Exports ──────────────────────────────────────────────────────────

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    AddItemIntentHandler,
    GetListIntentHandler,
    CheckOffIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandler(ErrorHandler)
  .lambda();