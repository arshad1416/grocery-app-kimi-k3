# PantryRun Architecture: Smart Home Integration

**Feature:** Voice-activated grocery list management via Home Assistant, Google Home, and Amazon Alexa  
**Tag:** `v1.03+`  
**Date:** 2026-06-15  

---

## 1. Overview

PantryRun is a privacy-first, E2E-encrypted grocery list app with a self-hosted relay server. Adding smart home voice integration lets family members add items hands-free while cooking, cleaning, or driving.

### Design Constraint: E2E Encryption

The relay server **never sees plaintext list data**. Voice integrations must work within this constraint. The approach: voice commands produce structured item data that is encrypted client-side before reaching the relay.

---

## 2. Integration Architecture — Three Approaches

### Approach A: Home Assistant as Central Hub (RECOMMENDED)

```
Voice Speaker (Echo / Google Nest / iPhone Siri)
  │
  ▼
Smart Platform (Alexa / Google Home / Siri)
  │  Skill / Action routes voice to webhook
  ▼
Home Assistant (ha.arshadkazi.ca)
  │  Automation / REST command / Conversation Agent
  ▼
Relay Server Webhook (POST /api/voice/add-item)
  │  HMAC-verified, authenticated
  ▼
WebSocket Relay → App (Yjs CRDT merge)
```

**Why this works best for Arshad's setup:**
- HA is already running at `ha.arshadkazi.ca` via Cloudflare Tunnel.
- HA has built-in Alexa Skill and Google Assistant integrations.
- HA can call the relay server's REST webhook directly.
- One integration point handles all three voice platforms.
- No additional cloud services needed.

### Approach B: Direct Skill → Relay (Alexa/Google call relay directly)

```
Alexa Skill → Lambda → Relay Server Webhook
Google Action → Cloud Function → Relay Server Webhook
```

**Pros:** Fewer hops, lower latency.  
**Cons:** Requires maintaining separate Alexa Skill + Google Action code. Needs cloud functions (AWS Lambda / Google Cloud). Adds recurring complexity.

### Approach C: IFTTT as Intermediary

```
Alexa / Google Home → IFTTT → Relay Server Webhook
```

**Pros:** Zero code for skill development.  
**Cons:** IFTTT has rate limits on free tier, adds latency, and is another third-party dependency. PantryRun already has IFTTT webhook code (`src/voice/ifttt.ts`) but this was designed for outbound (app → IFTTT), not inbound.

### Recommendation

**Approach A (Home Assistant as Hub)** is the clear winner for Arshad's setup:
- All three voice platforms route through HA (single integration point).
- HA already handles Alexa and Google Assistant natively.
- No cloud functions or Lambda to maintain.
- The relay server only needs one new REST endpoint.
- HA automations are declarative YAML — easy to maintain.

---

## 3. Detailed Architecture: Home Assistant Hub

### 3.1 Voice Platform Integrations

#### Amazon Alexa

HA has a native **Alexa Smart Home Skill** integration. Two options:

| Method | How It Works | Setup Complexity |
|--------|-------------|-----------------|
| **HA Cloud (Nabu Casa)** | One-click Alexa integration | Low ($6.50/mo) |
| **Custom Alexa Skill** | Alexa Skill → Lambda → HA webhook | Medium (free) |

**Recommended: Custom Alexa Skill** (free, self-hosted)

1. Create an Alexa Skill with invocation name "PantryRun" or use a routine trigger.
2. The Skill's Lambda function calls `https://ha.arshadkazi.ca/api/webhook/pantryrun-add-item`.
3. HA processes the webhook and calls the relay server.

**Alternative: Alexa Routines + HA**

Since Arshad already has Echo devices:
1. Create an Alexa Routine: "Alexa, add [item] to shopping list".
2. The routine sends a webhook to HA.
3. HA forwards to the relay server.

This avoids building a custom skill entirely.

#### Google Home

HA supports Google Assistant via:

| Method | How It Works | Setup Complexity |
|--------|-------------|-----------------|
| **HA Cloud (Nabu Casa)** | One-click Google integration | Low ($6.50/mo) |
| **Actions on Google + HA** | Custom Action → webhook → HA | Medium (free) |
| **Google Home Routines** | "Hey Google, add [item]" → webhook | Low (free) |

**Recommended: Google Home Routines**

1. Create a Google Home Routine: "Hey Google, add [item] to shopping".
2. The routine triggers a webhook to HA.
3. HA forwards to the relay server.

**Alternative: HA Conversation Agent**

HA's built-in conversation agent can parse natural language:
- "Add milk to PantryRun list" → HA automation → relay webhook.
- Works with any voice assistant that can trigger HA automations.

#### Home Assistant Voice (Optional)

If Arshad adds an HA Voice PE or other HA-connected microphone:
- Direct integration — no third-party voice platform needed.
- "Hey Home Assistant, add milk to the grocery list" → HA automation → relay.

### 3.2 Relay Server: New REST Endpoint

Add `POST /api/voice/add-item` to `relay-server/server.js`.

```
POST /api/voice/add-item
Content-Type: application/json
Authorization: Bearer <api-key>

{
  "familyId": "family-abc123",
  "listId": "list-xyz789",       // optional — uses default list if omitted
  "item": {
    "name": "milk",
    "quantity": 1,
    "unit": "each"
  },
  "source": "home-assistant",     // for logging/rate limiting
  "timestamp": 1718456789000,
  "hmac": "a1b2c3..."             // HMAC-SHA256 signature
}
```

**Response:**
```json
{
  "success": true,
  "itemId": "generated-uuid",
  "listId": "list-xyz789",
  "message": "Added milk to My Grocery List"
}
```

#### Security Model

The relay server cannot decrypt list data (E2E encryption). But it **can** inject items into the Yjs CRDT by:

1. Receiving the plaintext item from the webhook.
2. Encrypting the item fields using a **voice integration key** shared between the relay server and the app.
3. Creating a Yjs update that adds the item to the list's document.
4. Broadcasting the update via WebSocket to all family members.

**Wait — this breaks E2E encryption if the relay has the encryption key.**

Better approach: **The relay server doesn't create Yjs updates directly.** Instead:

1. The webhook receives the plaintext item.
2. The relay server stores it in a **pending voice items queue** (in-memory or file-backed).
3. When the app connects via WebSocket, the relay sends a `voice_item_pending` message.
4. The app receives the message, encrypts the item, and creates the Yjs update locally.
5. The Yjs update syncs to all family members via the normal CRDT path.

**This preserves E2E encryption** — the relay never holds the encryption key. It only passes opaque data between the webhook and the app.

### 3.3 Voice Item Flow (E2E-Preserving)

```
                    ┌─────────────────────────────────────┐
                    │          RELAY SERVER                │
                    │                                     │
  POST /api/voice/  │   ┌──────────────────────┐         │
  add-item ─────────┼──→│  Voice Queue          │         │
  (plaintext item)  │   │  (per familyId)       │         │
                    │   └──────────┬───────────┘         │
                    │              │                       │
                    │              ▼                       │
                    │   WebSocket message:                 │
                    │   { type: 'voice_item',              │
                    │     familyId, listId, item }         │
                    │              │                       │
                    └──────────────┼───────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │         APP (any device)      │
                    │                              │
                    │   On voice_item received:    │
                    │   1. Decrypt nothing (item   │
                    │      is plaintext — it's from│
                    │      a trusted webhook)      │
                    │   2. Encrypt item fields     │
                    │      with master key         │
                    │   3. yjsAddItem(listId, item)│
                    │   4. Yjs CRDT syncs to all   │
                    │      family members           │
                    └──────────────────────────────┘
```

**Alternative (simpler, slight encryption trade-off):**

If the webhook uses a shared HMAC secret (not the E2E encryption key), the relay can create a Yjs-compatible update directly. The HMAC secret only authenticates the webhook — it doesn't encrypt list data. The relay would need a **per-family voice token** that the app generates and shares with HA during setup.

**Recommended approach for v1:** Use the **pending queue** model. It's more secure and the latency (seconds at most) is acceptable for voice-added items.

---

## 4. Home Assistant Configuration

### 4.1 HA Webhook Automation

Create an automation in HA that accepts voice commands and forwards to the relay server.

**File: `automations.yaml`** (in HA config)

```yaml
# Automation: Add item to PantryRun grocery list via voice
- alias: "PantryRun - Add Item to Grocery List"
  trigger:
    - platform: webhook
      webhook_id: "pantryrun-add-item"
      allowed_methods:
        - POST
  action:
    - service: rest_command.pantryrun_add_item
      data:
        family_id: "{{ trigger.json.family_id | default('your-family-id') }}"
        list_id: "{{ trigger.json.list_id | default('') }}"
        item_name: "{{ trigger.json.item_name }}"
        item_quantity: "{{ trigger.json.item_quantity | default(1) }}"
        item_unit: "{{ trigger.json.item_unit | default('each') }}"
```

### 4.2 HA REST Command

**File: `configuration.yaml`**

```yaml
rest_command:
  pantryrun_add_item:
    url: "http://<relay-server-host>:8080/api/voice/add-item"
    method: POST
    headers:
      Content-Type: "application/json"
      Authorization: "Bearer !secret pantryrun_api_key"
    payload: >
      {
        "familyId": "{{ family_id }}",
        "listId": "{{ list_id }}",
        "item": {
          "name": "{{ item_name }}",
          "quantity": {{ item_quantity }},
          "unit": "{{ item_unit }}"
        },
        "source": "home-assistant",
        "timestamp": {{ now().timestamp() | int * 1000 }}
      }
```

**File: `secrets.yaml`**

```yaml
pantryrun_api_key: "your-voice-integration-api-key-here"
```

### 4.3 HA Conversation Agent (Natural Language)

For a more natural experience, use HA's conversation agent with intent scripts:

**File: `configuration.yaml`**

```yaml
intent_script:
  PantryRunAddItem:
    speech:
      text: "Added {{ item_name }} to your grocery list"
    action:
      - service: rest_command.pantryrun_add_item
        data:
          family_id: "your-family-id"
          item_name: "{{ item_name }}"
          item_quantity: "{{ item_quantity | default(1) }}"
          item_unit: "{{ item_unit | default('each') }}"
```

**File: `custom_sentences/en/pantryrun.yaml`**

```yaml
language: "en"
intents:
  PantryRunAddItem:
    data:
      - sentences:
          - "add {item_name} to [the] (grocery|shopping|pantryrun) list"
          - "add {item_name} to pantryrun"
          - "put {item_name} on [the] (grocery|shopping) list"
          - "i need {item_name}"
          - "we need {item_name}"
          - "buy {item_name}"
          - "get {item_name}"
        requires_context:
          domain: "pantryrun"
```

This allows natural language via HA's built-in voice pipeline or any integrated voice assistant.

### 4.4 Alexa Routine Integration

Create an Alexa Routine (via Alexa app):

1. **Trigger:** "Alexa, add [item] to shopping list" (or custom phrase)
2. **Action:** "Webhook" → POST to `https://ha.arshadkazi.ca/api/webhook/pantryrun-add-item`
3. **Payload:**
   ```json
   {
     "item_name": "{{Alexa.Intent.slot.item}}",
     "family_id": "your-family-id"
   }
   ```

**Note:** Alexa Routines don't support dynamic slot variables directly. The workaround is to use a **Custom Alexa Skill** that captures the item name and sends it to HA.

### 4.5 Google Home Routine Integration

Create a Google Home Routine (via Google Home app):

1. **Trigger:** "Hey Google, add [item] to shopping"
2. **Action:** "Adjust Home Devices" → "Try adding your own" → Webhook
3. **URL:** `https://ha.arshadkazi.ca/api/webhook/pantryrun-add-item`

**Limitation:** Google Home Routines have limited webhook support. The more robust approach is using **Actions on Google** with a webhook fulfillment.

---

## 5. Relay Server Changes

### 5.1 New Endpoint: `POST /api/voice/add-item`

**Add to `relay-server/server.js`:**

```javascript
// ─── Voice Integration Endpoint ──────────────────────────────────────────

/**
 * Voice item queue: Map<familyId, Array<{item, listId, timestamp, source}>>
 * Items are queued until an app device connects and pulls them.
 */
const voiceItemQueue = new Map();

/** HMAC secret for voice webhook authentication */
const VOICE_HMAC_SECRET = process.env.VOICE_HMAC_SECRET || '';

/** Rate limit: max 30 voice items per family per minute */
const VOICE_RATE_LIMIT = 30;
const VOICE_RATE_WINDOW_MS = 60_000;
const voiceRateLimiters = new Map();

function checkVoiceRateLimit(familyId) {
  const now = Date.now();
  let limiter = voiceRateLimiters.get(familyId);
  if (!limiter || now - limiter.windowStart > VOICE_RATE_WINDOW_MS) {
    limiter = { count: 1, windowStart: now };
    voiceRateLimiters.set(familyId, limiter);
    return true;
  }
  limiter.count++;
  return limiter.count <= VOICE_RATE_LIMIT;
}

function verifyHmac(payload, signature) {
  if (!VOICE_HMAC_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', VOICE_HMAC_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  );
}
```

**Route handler:**

```javascript
if (req.url === '/api/voice/add-item' && req.method === 'POST') {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (body.length > 4096) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Body too large' }));
      return;
    }

    try {
      const data = JSON.parse(body);
      const { familyId, listId, item, source, timestamp, hmac } = data;

      // Validate required fields
      if (!familyId || !item?.name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'familyId and item.name required' }));
        return;
      }

      // Verify HMAC signature
      const payloadForSig = { familyId, listId, item, source, timestamp };
      if (!verifyHmac(payloadForSig, hmac)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      // Rate limit
      if (!checkVoiceRateLimit(familyId)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }

      // Queue the item
      if (!voiceItemQueue.has(familyId)) {
        voiceItemQueue.set(familyId, []);
      }
      voiceItemQueue.get(familyId).push({
        item: {
          name: item.name,
          quantity: item.quantity || 1,
          unit: item.unit || 'each',
        },
        listId: listId || null,
        source: source || 'unknown',
        timestamp: timestamp || Date.now(),
      });

      // Also try to push via WebSocket if family is connected
      const room = familyRooms.get(familyId);
      if (room && room.size > 0) {
        const voiceMessage = {
          type: 'voice_item',
          familyId,
          listId: listId || null,
          item: {
            name: item.name,
            quantity: item.quantity || 1,
            unit: item.unit || 'each',
          },
          source: source || 'unknown',
        };
        room.forEach((client) => {
          if (client.readyState === client.OPEN) {
            sendTo(client, voiceMessage);
          }
        });
        // Clear from queue since we pushed it live
        voiceItemQueue.get(familyId).pop();
      }

      console.log(`[voice] Item "${item.name}" queued for family "${familyId}" from ${source}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: `Added ${item.name} to your grocery list`,
      }));
    } catch (err) {
      console.warn(`[voice] Error: ${err.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  });
  return;
}
```

### 5.2 New WebSocket Message: `voice_item`

When a voice item arrives while the family is connected, push it immediately via WebSocket:

```javascript
// In handleMessage(), add a new case:
case 'pull_voice_items': {
  // Client requests any pending voice items
  if (!sender._relayToken) {
    sendTo(sender, { type: 'error', message: 'Not authenticated' });
    return;
  }
  const senderInfo = clientInfo.get(sender);
  if (!senderInfo) return;

  const queue = voiceItemQueue.get(senderInfo.familyId);
  if (queue && queue.length > 0) {
    for (const queued of queue) {
      sendTo(sender, {
        type: 'voice_item',
        familyId: senderInfo.familyId,
        ...queued,
      });
    }
    queue.length = 0; // Clear the queue
  }
  break;
}
```

### 5.3 New WebSocket Message: `voice_item_ack`

The app acknowledges receipt of a voice item:

```javascript
case 'voice_item_ack': {
  // App confirms it processed the voice item — no action needed
  // This is for monitoring/logging only
  console.log(`[voice] Item acknowledged by device`);
  break;
}
```

---

## 6. App-Side Changes

### 6.1 New File: `src/voice/homeAssistant.ts`

```typescript
/**
 * Home Assistant Voice Integration Client.
 *
 * Handles incoming voice items from the relay server's voice queue.
 * These items arrive as plaintext (from trusted webhook) and must be
 * encrypted and added to the local Yjs document.
 */

import type { ParsedItem } from './types';
import { generateUUID } from '../crypto';
import { getDoc, yjsAddItem } from '../sync/yjs-adapter';
import { syncManager } from '../sync/sync-manager';

export interface VoiceItemMessage {
  type: 'voice_item';
  familyId: string;
  listId: string | null;
  item: {
    name: string;
    quantity: number;
    unit: string;
  };
  source: string;
}

/**
 * Handle an incoming voice item from the relay server.
 * Creates a GroceryItem and adds it via Yjs.
 */
export async function handleVoiceItem(message: VoiceItemMessage): Promise<void> {
  const { familyId, listId, item, source } = message;

  // Determine target list
  const targetListId = listId || await getDefaultListId(familyId);
  if (!targetListId) {
    console.warn('[Voice:HA] No target list found for voice item');
    return;
  }

  // Create a GroceryItem
  const itemId = await generateUUID();
  const now = Date.now();

  const groceryItem = {
    id: itemId,
    listId: targetListId,
    familyId,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    category: 'other', // Default — user can categorize later
    isChecked: false,
    addedBy: `voice-${source}`,
    sortOrder: Date.now(),
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created' as const,
    createdAt: now,
    updatedAt: now,
  };

  // Add via Yjs (this will trigger sync to all family members)
  yjsAddItem(targetListId, groceryItem);

  // Send notification to family
  const encryptionKey = syncManager.getEncryptionKey();
  if (encryptionKey) {
    const { sendFamilyNotification } = await import('../notifications/NotificationManager');
    await sendFamilyNotification(
      'item_added',
      targetListId,
      'Voice Item',
      itemId,
      item.name,
      'other',
      encryptionKey,
    );
  }

  console.log(`[Voice:HA] Added "${item.name}" to list ${targetListId}`);
}

/**
 * Get the default (first active) list for a family.
 */
async function getDefaultListId(familyId: string): Promise<string | null> {
  const { getDoc, extractList } = await import('../sync/yjs-adapter');
  const indexDoc = getDoc('__lists_index__');
  const indexMap = indexDoc.getMap('listIds');

  let defaultListId: string | null = null;
  indexMap.forEach((_value: any, key: string) => {
    if (!defaultListId) {
      const list = extractList(key);
      if (list && !list.isDeleted && list.familyId === familyId) {
        defaultListId = key;
      }
    }
  });

  return defaultListId;
}
```

### 6.2 Modify: `src/sync/sync-manager.ts`

Add handling for the `voice_item` WebSocket message in the `onRemoteUpdate` callback:

```typescript
// In init(), add a new handler:
this.wsClient.onVoiceItem = (message: VoiceItemMessage) => {
  this.handleVoiceItem(message);
};

// New method:
private async handleVoiceItem(message: VoiceItemMessage): Promise<void> {
  try {
    const { handleVoiceItem } = await import('../voice/homeAssistant');
    await handleVoiceItem(message);
  } catch (err) {
    console.warn('[SyncManager] Failed to handle voice item:', err);
  }
}
```

### 6.3 Modify: `src/sync/y-websocket.ts`

Add handling for the `voice_item` message type:

```typescript
// In the message handler:
case 'voice_item':
  this.onVoiceItem?.(message);
  break;

// Add to the class interface:
onVoiceItem?: (message: any) => void;
```

### 6.4 On Connect: Pull Pending Voice Items

When the app connects to the relay, request any queued voice items:

```typescript
// In y-websocket.ts, after successful auth:
sendTo(ws, { type: 'pull_voice_items' });
```

---

## 7. NLP Enhancement for Voice Commands

The existing `src/voice/nlp.ts` parser handles item parsing well. For smart home integration, add platform-specific prefix stripping:

### 7.1 Modify: `src/voice/nlp.ts`

Add smart home prefixes to `MULTI_WORD_FILLER_PREFIXES`:

```typescript
const MULTI_WORD_FILLER_PREFIXES = [
  // Existing fillers...
  'i would like to get',
  'i need to get',
  'can i get',
  // ...

  // Smart home specific (NEW)
  'add to the shopping list',
  'add to the grocery list',
  'add to my shopping list',
  'add to my grocery list',
  'add to pantryrun',
  'put on the shopping list',
  'put on the grocery list',
  'add to the list',
  'add to list',
].sort((a, b) => b.length - a.length);
```

### 7.2 New Module: `src/voice/smartHomeParser.ts`

A dedicated parser for smart home voice commands that returns structured data suitable for the relay webhook:

```typescript
export interface SmartHomeCommand {
  action: 'add' | 'remove' | 'check' | 'list';
  item?: ParsedItem;
  listName?: string;
}

export function parseSmartHomeCommand(text: string): SmartHomeCommand {
  const lower = text.toLowerCase().trim();

  // "add milk to the shopping list"
  const addMatch = lower.match(
    /^(?:add|put|get|buy|need|want)\s+(.+?)(?:\s+to\s+(?:the\s+)?(?:grocery|shopping|pantryrun)?\s*list)?$/i
  );
  if (addMatch) {
    const item = parseVoiceText(addMatch[1]);
    return { action: 'add', item };
  }

  // "what's on the list"
  const listMatch = lower.match(/^(?:what'?s|show|read)\s+(?:on|in)\s+(?:the\s+)?list/i);
  if (listMatch) {
    return { action: 'list' };
  }

  // "check off milk"
  const checkMatch = lower.match(/^(?:check|mark|done)\s+(?:off\s+)?(.+)/i);
  if (checkMatch) {
    const item = parseVoiceText(checkMatch[1]);
    return { action: 'check', item };
  }

  // Fallback: treat as add
  const item = parseVoiceText(text);
  return { action: 'add', item };
}
```

---

## 8. Security Model

### 8.1 Authentication Layers

```
Layer 1: HMAC-SHA256 signature on webhook payload
  └── Shared secret between HA and relay server
  └── Prevents unauthorized webhook calls

Layer 2: Voice API key (Bearer token)
  └── Configured in HA secrets.yaml
  └── Separate from relay token / enrollment token

Layer 3: Rate limiting per family (30 items/min)
  └── Prevents abuse from compromised webhook

Layer 4: Family ID validation
  └── Relay verifies familyId exists and has active members
```

### 8.2 E2E Encryption Preservation

```
                    ┌──────────────────────────────────────────┐
                    │           ENCRYPTION BOUNDARY            │
                    │                                          │
  Voice Speaker ──→ │  HA webhook (plaintext)                  │
                    │    ↓                                     │
                    │  Relay server (plaintext item)           │
                    │    ↓                                     │
                    │  WebSocket push (plaintext item)         │
                    │    ↓                                     │
                    │  ┌─────────────────────────────────┐     │
                    │  │  APP (encryption happens here)  │     │
                    │  │  1. Receive plaintext item      │     │
                    │  │  2. Encrypt with master key     │     │
                    │  │  3. yjsAddItem()                │     │
                    │  │  4. Yjs CRDT sync (encrypted)   │     │
                    │  └─────────────────────────────────┘     │
                    │    ↓                                     │
                    │  Other family devices (encrypted)         │
                    │                                          │
                    └──────────────────────────────────────────┘
```

The relay server sees the plaintext item only transiently (in the webhook handler). It does NOT store it long-term — it either pushes it immediately via WebSocket or queues it briefly for the next app connection.

### 8.3 API Key Generation

During setup, the app generates a voice integration API key:

```typescript
// In src/voice/homeAssistant.ts
export async function generateVoiceApiKey(): Promise<string> {
  const sodium = await getSodium();
  const keyBytes = sodium.randombytes_buf(32);
  return sodium.to_base64(keyBytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}
```

The key is:
1. Generated by the app.
2. Displayed to the user (QR code or copy-to-clipboard).
3. User adds it to HA's `secrets.yaml`.
4. Stored in the app's encrypted settings.

---

## 9. Settings UI

### 9.1 New Settings Section: "Smart Home Integration"

Add to `src/screens/SettingsScreen.tsx`:

```
┌─────────────────────────────────────────────┐
│  Smart Home Integration                     │
│                                             │
│  Home Assistant          [Toggle: OFF]      │
│  Relay URL: ha.arshadkazi.ca                │
│  API Key:   ••••••••••••    [Copy] [Regen]  │
│                                             │
│  Alexa                  [Toggle: OFF]       │
│  Status: Not configured                     │
│  [Setup Guide]                              │
│                                             │
│  Google Home            [Toggle: OFF]       │
│  Status: Not configured                     │
│  [Setup Guide]                              │
│                                             │
│  Default List: My Grocery List  [Change]    │
│                                             │
└─────────────────────────────────────────────┘
```

### 9.2 Settings Type Extension

Add to `src/types/index.ts` in `AppSettings`:

```typescript
// Smart Home Integration
smartHomeEnabled?: boolean;
voiceApiKey?: string;              // encrypted in secure store
defaultVoiceListId?: string;       // which list voice items go to
homeAssistantUrl?: string;         // HA URL for direct integration
```

---

## 10. Setup Flow

### 10.1 User-Facing Setup Steps

1. **In PantryRun app:** Go to Settings → Smart Home Integration → Enable.
2. **App generates** an API key and displays it.
3. **User copies** the API key.
4. **In Home Assistant:** Add the REST command and automation (or import a blueprint).
5. **User pastes** the API key into HA's `secrets.yaml`.
6. **In Alexa/Google Home app:** Create a routine that triggers the HA webhook.
7. **Test:** Say "Alexa, add milk to shopping list" → verify item appears in PantryRun.

### 10.2 HA Blueprint (Simplified Setup)

Create a downloadable HA blueprint that automates the setup:

```yaml
blueprint:
  name: PantryRun Grocery List Integration
  description: Add items to PantryRun grocery list via voice
  domain: automation
  input:
    pantryrun_api_key:
      name: PantryRun API Key
      description: Your PantryRun voice integration API key
    pantryrun_relay_url:
      name: Relay Server URL
      default: "http://localhost:8080"
    pantryrun_family_id:
      name: Family ID
```

This allows one-click import in HA.

---

## 11. File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `relay-server/server.js` | **MODIFY** | Add `/api/voice/add-item` endpoint, `voice_item` WebSocket message, HMAC verification |
| `src/voice/homeAssistant.ts` | **CREATE** | Voice item handler, API key generation |
| `src/voice/smartHomeParser.ts` | **CREATE** | Smart home command parser |
| `src/voice/nlp.ts` | **MODIFY** | Add smart home filler prefixes |
| `src/sync/sync-manager.ts` | **MODIFY** | Add `onVoiceItem` handler, pull pending items on connect |
| `src/sync/y-websocket.ts` | **MODIFY** | Add `voice_item` message handling, `pull_voice_items` on connect |
| `src/types/index.ts` | **MODIFY** | Add smart home settings fields |
| `src/screens/SettingsScreen.tsx` | **MODIFY** | Add Smart Home Integration settings section |
| `docs/ha-blueprint.yaml` | **CREATE** | HA automation blueprint for easy setup |

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Test | Description |
|------|-------------|
| `parseSmartHomeCommand` | Various voice command patterns |
| HMAC signature generation/verification | Valid and invalid signatures |
| Voice item queue | Queue, dequeue, overflow |
| Rate limiting | Per-family voice rate limits |

### 12.2 Integration Tests

| Test | Description |
|------|-------------|
| Webhook → Queue → WebSocket push | Full flow with mock WebSocket |
| Webhook → Queue → Pull on connect | Deferred delivery |
| HMAC verification failure | Reject unsigned requests |
| Rate limit exceeded | 429 response |

### 12.3 End-to-End Tests

| Test | Description |
|------|-------------|
| Alexa routine → HA → Relay → App | Full voice flow |
| Google routine → HA → Relay → App | Full voice flow |
| HA conversation agent → Relay → App | Natural language |
| Offline queue → Reconnect → Delivery | Deferred delivery |

---

## 13. Future Enhancements

1. **Voice response:** HA responds with "Added milk to your grocery list" via TTS.
2. **Multi-list support:** "Add milk to the Costco list" → routes to named list.
3. **Remove items:** "Remove milk from the list" → marks item as deleted.
4. **Read list:** "What's on the shopping list?" → HA reads back unchecked items.
5. **Smart suggestions:** Based on purchase history, suggest items via voice.
6. **Apple HomePod:** Siri Shortcuts integration (existing `src/voice/siri.ts`).
7. **HA custom component:** A proper HA integration (HACS component) instead of YAML configuration.
