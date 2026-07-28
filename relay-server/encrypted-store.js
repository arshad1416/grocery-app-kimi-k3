const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const UPDATES_FILE = path.join(DATA_DIR, 'encrypted-updates.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAllUpdates() {
  try {
    if (fs.existsSync(UPDATES_FILE)) {
      return JSON.parse(fs.readFileSync(UPDATES_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('[encrypted-store] Failed to load updates:', err.message);
  }
  return {};
}

function saveAllUpdates(data) {
  try {
    fs.writeFileSync(UPDATES_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[encrypted-store] Failed to save updates:', err.message);
  }
}

function getUpdates(familyId, listId) {
  const data = loadAllUpdates();
  const familyData = data[familyId] || {};
  return familyData[listId] || [];
}

function getAllUpdates(familyId) {
  const data = loadAllUpdates();
  return data[familyId] || {};
}

function addUpdate(familyId, listId, update) {
  const data = loadAllUpdates();
  if (!data[familyId]) {
    data[familyId] = {};
  }
  if (!data[familyId][listId]) {
    data[familyId][listId] = [];
  }
  
  // Validate update structure
  if (!update || typeof update.ciphertext !== 'string' || typeof update.iv !== 'string' || typeof update.tag !== 'string') {
    throw new Error('Invalid update payload format. Expected { ciphertext, iv, tag }');
  }
  
  // Stamp arrival time so retention cleanup can age entries out.
  data[familyId][listId].push({ ...update, storedAt: Date.now() });
  saveAllUpdates(data);
  return data[familyId][listId];
}

/**
 * Delete stored updates older than ttlMs. Entries persisted before storedAt
 * stamping existed are stamped now and age out one TTL later (never deleted
 * eagerly). Returns the number of updates removed.
 */
function cleanupExpiredUpdates(ttlMs) {
  const now = Date.now();
  const data = loadAllUpdates();
  let removed = 0;
  let changed = false;

  for (const familyId of Object.keys(data)) {
    for (const listId of Object.keys(data[familyId])) {
      const updates = data[familyId][listId];
      const kept = [];
      for (const update of updates) {
        if (typeof update.storedAt !== 'number') {
          kept.push({ ...update, storedAt: now });
          changed = true;
        } else if (now - update.storedAt >= ttlMs) {
          removed++;
          changed = true;
        } else {
          kept.push(update);
        }
      }
      if (kept.length === 0) {
        delete data[familyId][listId];
      } else {
        data[familyId][listId] = kept;
      }
    }
    if (Object.keys(data[familyId]).length === 0) {
      delete data[familyId];
    }
  }

  if (changed) {
    saveAllUpdates(data);
  }
  return removed;
}

module.exports = {
  getUpdates,
  getAllUpdates,
  addUpdate,
  cleanupExpiredUpdates
};
