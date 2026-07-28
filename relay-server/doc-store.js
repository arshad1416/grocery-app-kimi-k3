const fs = require('fs');
const path = require('path');
const Y = require('yjs');

const DOCS_FILE = process.env.DOCS_FILE || path.join(__dirname, 'relay-docs.json');

// Memory cache of Yjs documents: Map<familyId, Y.Doc>
const docCache = new Map();

function loadDoc(familyId) {
  if (docCache.has(familyId)) {
    return docCache.get(familyId);
  }

  const doc = new Y.Doc();
  try {
    if (fs.existsSync(DOCS_FILE)) {
      const data = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf-8'));
      const stateBase64 = data[familyId];
      if (stateBase64) {
        const state = Buffer.from(stateBase64, 'base64');
        Y.applyUpdate(doc, new Uint8Array(state));
      }
    }
  } catch (err) {
    console.error(`[doc-store] Failed to load doc for family ${familyId}:`, err.message);
  }

  docCache.set(familyId, doc);
  return doc;
}

function saveDoc(familyId, doc) {
  try {
    const state = Y.encodeStateAsUpdate(doc);
    const stateBase64 = Buffer.from(state).toString('base64');

    let data = {};
    if (fs.existsSync(DOCS_FILE)) {
      data = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf-8'));
    }
    data[familyId] = stateBase64;
    fs.writeFileSync(DOCS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[doc-store] Failed to save doc for family ${familyId}:`, err.message);
  }
}

function applyUpdate(familyId, updateUint8Array) {
  const doc = loadDoc(familyId);
  Y.applyUpdate(doc, updateUint8Array);
  saveDoc(familyId, doc);
  return doc;
}

module.exports = {
  loadDoc,
  saveDoc,
  applyUpdate
};
