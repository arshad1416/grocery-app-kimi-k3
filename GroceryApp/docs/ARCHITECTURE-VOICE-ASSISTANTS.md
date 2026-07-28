# StopHop Architecture: Direct Google Assistant & Amazon Alexa Integrations

> ⚠️ **STATUS (2026-07-06): DISABLED IN v1 — NOT SHIPPED.**
> Still off in v1 (client UI hidden behind `VOICE_ASSISTANT_LINKING_ENABLED=false`
> in SettingsScreen; relay endpoints 404 unless `ASSISTANT_INTEGRATION=true`,
> pinned by `relay-server/assistant-disabled.test.js`). Siri (on-device,
> `src/voice/siri.ts`) is unaffected and ships in v1.
>
> **Key-custody flaw FIXED (2026-07-06).** The relay no longer generates or
> holds the assistant RSA private key. It serves only the *public* key
> (`ASSISTANT_PUBLIC_KEY`, generated out of band by `assistant-keygen.js`) and
> fails closed if it isn't provisioned; the private key lives ONLY in the
> deployed webhook's environment (`ASSISTANT_PRIVATE_KEY`). So the relay —
> which stores all ciphertext and the sealed family keys — is now
> cryptographically unable to read any of it. Pinned by
> `relay-server/assistant-key-custody.test.js`.
>
> **Residual (inherent to cloud voice, NOT a bug):** the webhook still
> transiently decrypts list content while answering a request — no cloud
> assistant can be zero-knowledge, since Amazon/Google invoke the webhook and
> plaintext must exist there to answer. Re-enabling for real still requires:
> (1) in-app disclosure + matching privacy-label/data-safety updates, (2) a
> deployed webhook holding the private key, and (3) ideally a key hierarchy so
> the webhook receives only a derived sync subkey, not the root master key
> (see §7.2 and `docs/MONETIZATION.md`).

**Feature:** Standalone voice assistant integrations (no Home Assistant dependency)  
**Tag:** `v1.03+`  
**Date:** 2026-06-15  
**Supersedes:** Approach B in `ARCHITECTURE-SMART-HOME.md`

---

## 1. Problem Statement

The existing smart home architecture (`ARCHITECTURE-SMART-HOME.md`) routes all voice commands through Home Assistant as a hub. While this works for Arshad's setup, most households don't run Home Assistant. This document designs **direct, standalone integrations** where Google Assistant and Amazon Alexa talk to the StopHop relay server without any intermediary.

**Goal:** Any user with a Google Home or Echo device can say "Add milk to the grocery list" and have it appear in their shared StopHop list — without installing Home Assistant.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        STANDALONE VOICE ARCHITECTURE                    │
│                                                                         │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────────┐ │
│  │ Google Home / │    │  AWS Lambda /    │    │   StopHop Relay      │ │
│  │ Nest Speaker  │───→│  Google Cloud    │───→│   Server (self-host) │ │
│  │              │    │  Function        │    │                       │ │
│  │ "Add milk"   │    │  (NLU + routing) │    │  /api/voice/add-item  │ │
│  └──────────────┘    └──────────────────┘    │  /api/voice/read-list │ │
│                                              │  /api/voice/check-item│ │
│  ┌──────────────┐    ┌──────────────────┐    │                       │ │
│  │ Amazon Echo / │    │  AWS Lambda      │    │   Voice Item Queue   │ │
│  │ Alexa Device  │───→│  (ASK Runtime)   │───→│       ↓              │ │
│  │              │    │                  │    │   WebSocket push      │ │
│  │ "Add milk"   │    │  NLU + routing   │    │       ↓              │ │
│  └──────────────┘    └──────────────────┘    │   App encrypts +     │ │
│                                              │   Yjs CRDT merge     │ │
│                                              └───────────────────────┘ │
│                                                        ↓               │
│                                              Family devices sync       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key difference from HA-hub approach:** Google/Alexa cloud → Lambda/Cloud Function → Relay (direct). No Home Assistant in the loop.

---

## 3. Account Linking Strategy

Both Google and Alexa require **OAuth 2.0 account linking** to associate a user's voice assistant account with their StopHop family. Since StopHop has no OAuth server, we implement a lightweight one.

### 3.1 Lightweight OAuth Server (on the Relay)

The relay server acts as a minimal OAuth 2.0 authorization server supporting the **Authorization Code** flow (required by both platforms).

```
┌──────────────────────────────────────────────────────────────┐
│                    ACCOUNT LINKING FLOW                       │
│                                                              │
│  User says: "Hey Google, talk to StopHop"                    │
│       ↓                                                      │
│  Google/Alexa opens account linking web page                 │
│       ↓                                                      │
│  Browser: https://relay.arshadkazi.ca/auth/link              │
│       ↓                                                      │
│  User enters:                                                │
│    1. Relay URL (auto-filled if using custom domain)         │
│    2. Family pairing code (from StopHop app)                 │
│       ↓                                                      │
│  Relay validates pairing code → issues auth code             │
│       ↓                                                      │
│  Google/Alexa exchanges auth code → gets access token        │
│       ↓                                                      │
│  Token stored by Google/Amazon for future voice requests     │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 New Relay Endpoints for OAuth

```
GET  /auth/link              — Account linking page (HTML form)
POST /auth/authorize          — Validate pairing code, issue auth code
POST /auth/token              — Exchange auth code for access token
POST /auth/revoke             — Revoke access token
GET  /auth/.well-known/openid-configuration  — OAuth discovery (optional)
```

### 3.3 Pairing Code Reuse

StopHop already has pairing codes (`PairingCode` in `src/types/index.ts`). We extend this system:

1. **App generates a voice pairing code** — a 6-digit code with a 10-minute TTL.
2. **User enters this code** on the OAuth linking page.
3. **Relay validates** against enrolled family devices.
4. **Issues a scoped access token** tied to the familyId.

```typescript
// New type for voice pairing
interface VoicePairingCode {
  code: string;            // 6-digit numeric
  familyId: string;
  deviceId: string;        // device that generated the code
  expiresAt: number;       // 10 min TTL
  used: boolean;
  scope: 'voice_read' | 'voice_write' | 'voice_full';
}
```

### 3.4 Token Scopes

| Scope | Permissions | Use Case |
|-------|-------------|----------|
| `voice_read` | Read list items | "What's on the list?" |
| `voice_write` | Add items only | "Add milk" |
| `voice_full` | Read + add + check off | Full voice control |

Default: `voice_full` (simplest UX).

---

## 4. Amazon Alexa Integration (Recommended: Custom Skill via ASK)

### 4.1 Recommended Approach: Alexa Skills Kit (ASK)

**Why ASK over alternatives:**

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Alexa Skills Kit (ASK)** | Full NLU, natural phrases, multi-turn dialog, free | Requires Lambda, skill certification | ✅ **RECOMMENDED** |
| Alexa Household Shopping List API | Native list integration | One-way sync, can't read back, Amazon controls the list | ❌ |
| Alexa Routines + Webhook | Zero code | No dynamic slot capture, can't pass item name | ❌ |
| IFTTT as intermediary | Simple | Latency, rate limits, third-party dependency | ❌ |

### 4.2 Skill Architecture

```
User: "Alexa, open StopHop"
  ↓
Alexa Cloud (NLU)
  ↓
AWS Lambda (ASK handler)
  ├── LaunchRequest    → "Welcome to StopHop. What would you like to do?"
  ├── AddItemIntent    → POST /api/voice/add-item to relay
  ├── ReadListIntent   → POST /api/voice/read-list to relay
  ├── CheckItemIntent  → POST /api/voice/check-item to relay
  └── HelpIntent       → "You can say: add milk, what's on the list..."
  ↓
StopHop Relay Server (self-hosted)
  ↓
WebSocket → App → Yjs CRDT → Family sync
```

### 4.3 Invocation Models

**Option A: Skill-specific invocation (recommended for v1)**
```
"Alexa, open StopHop and add milk"
"Alexa, ask StopHop what's on the list"
```

**Option B: Alexa Name-Free Interaction (AMAZON.SearchQuery)**
```
"Alexa, add milk to the shopping list"  ← routes to StopHop automatically
```
Option B requires skill certification and conflicts with Alexa's built-in shopping list. Start with Option A.

### 4.4 Interaction Model (Skill JSON)

```json
{
  "interactionModel": {
    "languageModel": {
      "invocationName": "stop hop",
      "intents": [
        {
          "name": "AddItemIntent",
          "slots": [
            {
              "name": "item",
              "type": "AMAZON.SearchQuery"
            },
            {
              "name": "quantity",
              "type": "AMAZON.NUMBER"
            },
            {
              "name": "listName",
              "type": "AMAZON.StreetName"
            }
          ],
          "samples": [
            "add {item}",
            "add {item} to the list",
            "add {quantity} {item}",
            "add {item} to {listName}",
            "put {item} on the list",
            "i need {item}",
            "buy {item}",
            "get {item}",
            "we need {item}",
            "add {item} to my grocery list"
          ]
        },
        {
          "name": "ReadListIntent",
          "slots": [
            {
              "name": "listName",
              "type": "AMAZON.StreetName"
            }
          ],
          "samples": [
            "what's on the list",
            "what's on my list",
            "read the list",
            "what do i need",
            "what's on {listName}",
            "read {listName}",
            "whats on the shopping list",
            "what's on the grocery list"
          ]
        },
        {
          "name": "CheckItemIntent",
          "slots": [
            {
              "name": "item",
              "type": "AMAZON.SearchQuery"
            }
          ],
          "samples": [
            "check off {item}",
            "mark {item} as done",
            "i got {item}",
            "i bought {item}",
            "done with {item}",
            "cross off {item}"
          ]
        },
        {
          "name": "AMAZON.HelpIntent"
        },
        {
          "name": "AMAZON.StopIntent"
        },
        {
          "name": "AMAZON.CancelIntent"
        }
      ]
    }
  }
}
```

### 4.5 Lambda Handler (Node.js)

```javascript
// lambda/stophop-alexa/index.js

const { SkillBuilders } = require('ask-sdk-core');
const https = require('https');

const RELAY_URL = process.env.STOPHOP_RELAY_URL; // e.g., relay.arshadkazi.ca

/**
 * Make an authenticated request to the StopHop relay server.
 * Uses the access token from the Alexa session (OAuth account linking).
 */
async function relayRequest(path, body, accessToken) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(`https://${RELAY_URL}${path}`);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: 'Invalid response' });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Launch Handler ──────────────────────────────────────────────────────

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speechText = `Welcome to StopHop! You can say "add milk", 
      "what's on the list", or "check off eggs". What would you like to do?`;
    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt('What would you like to add or check off?')
      .getResponse();
  },
};

// ─── Add Item Intent ─────────────────────────────────────────────────────

const AddItemIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AddItemIntent';
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    const slots = intent.slots;

    const itemRaw = slots.item?.value;
    const quantity = parseInt(slots.quantity?.value || '1', 10);
    const listName = slots.listName?.value || null;

    if (!itemRaw) {
      return handlerInput.responseBuilder
        .speak("I didn't catch the item name. What would you like to add?")
        .reprompt('What item should I add?')
        .getResponse();
    }

    // Clean up the item name (remove filler words the NLU might pass through)
    const itemName = itemRaw
      .replace(/^(add|put|get|buy|need|want)\s+/i, '')
      .replace(/\s+(to|on|in|for)\s+(the\s+)?(list|grocery|shopping).*$/i, '')
      .trim();

    const accessToken = handlerInput.requestEnvelope.context?.System?.user?.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak('Please link your StopHop account in the Alexa app first.')
        .getResponse();
    }

    try {
      const result = await relayRequest('/api/voice/add-item', {
        item: { name: itemName, quantity, unit: 'each' },
        listName,
        source: 'alexa',
        timestamp: Date.now(),
      }, accessToken);

      if (result.success) {
        const speech = result.itemCount > 1
          ? `Added ${itemName} to your list. You now have ${result.itemCount} items.`
          : `Added ${itemName} to your grocery list.`;

        return handlerInput.responseBuilder
          .speak(speech)
          .withShouldEndSession(true)
          .getResponse();
      }

      return handlerInput.responseBuilder
        .speak(`Sorry, I couldn't add ${itemName}. ${result.error || 'Please try again.'}`)
        .getResponse();
    } catch (err) {
      console.error('Relay request failed:', err);
      return handlerInput.responseBuilder
        .speak("Sorry, I couldn't reach your StopHop server. Is it running?")
        .getResponse();
    }
  },
};

// ─── Read List Intent ────────────────────────────────────────────────────

const ReadListIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'ReadListIntent';
  },
  async handle(handlerInput) {
    const slots = handlerInput.requestEnvelope.request.intent.slots;
    const listName = slots?.listName?.value || null;
    const accessToken = handlerInput.requestEnvelope.context?.System?.user?.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak('Please link your StopHop account in the Alexa app first.')
        .getResponse();
    }

    try {
      const result = await relayRequest('/api/voice/read-list', {
        listName,
        source: 'alexa',
      }, accessToken);

      if (result.success && result.items?.length > 0) {
        const itemList = result.items.map(i => {
          const qty = i.quantity > 1 ? `${i.quantity} ` : '';
          return `${qty}${i.name}`;
        });

        let speech;
        if (itemList.length === 1) {
          speech = `You have one item on your list: ${itemList[0]}.`;
        } else if (itemList.length <= 5) {
          const last = itemList.pop();
          speech = `You have ${result.items.length} items: ${itemList.join(', ')}, and ${last}.`;
        } else {
          speech = `You have ${result.items.length} items on your list. ` +
            `Here are the first five: ${itemList.slice(0, 5).join(', ')}. ` +
            `Say "read more" to hear the rest.`;
        }

        return handlerInput.responseBuilder
          .speak(speech)
          .reprompt('Would you like to add or check off anything?')
          .getResponse();
      }

      return handlerInput.responseBuilder
        .speak("Your grocery list is empty. What would you like to add?")
        .reprompt('What item should I add?')
        .getResponse();
    } catch (err) {
      console.error('Relay request failed:', err);
      return handlerInput.responseBuilder
        .speak("Sorry, I couldn't reach your StopHop server.")
        .getResponse();
    }
  },
};

// ─── Check Item Intent ───────────────────────────────────────────────────

const CheckItemIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'CheckItemIntent';
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    const itemRaw = intent.slots?.item?.value;
    const accessToken = handlerInput.requestEnvelope.context?.System?.user?.accessToken;

    if (!itemRaw || !accessToken) {
      return handlerInput.responseBuilder
        .speak("Which item would you like to check off?")
        .reprompt('Tell me the item name.')
        .getResponse();
    }

    try {
      const result = await relayRequest('/api/voice/check-item', {
        itemName: itemRaw,
        source: 'alexa',
        timestamp: Date.now(),
      }, accessToken);

      if (result.success) {
        return handlerInput.responseBuilder
          .speak(`Checked off ${itemRaw}.`)
          .getResponse();
      }

      return handlerInput.responseBuilder
        .speak(`I couldn't find "${itemRaw}" on your list. It may already be checked off.`)
        .getResponse();
    } catch (err) {
      return handlerInput.responseBuilder
        .speak("Sorry, I couldn't reach your StopHop server.")
        .getResponse();
    }
  },
};

// ─── Skill Builder ──────────────────────────────────────────────────────

exports.handler = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    AddItemIntentHandler,
    ReadListIntentHandler,
    CheckItemIntentHandler,
  )
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();
```

### 4.6 Account Linking Configuration (Alexa Developer Console)

```json
{
  "accountLinking": {
    "type": "AUTH_CODE",
    "authorizationUri": "https://relay.arshadkazi.ca/auth/link",
    "accessTokenUri": "https://relay.arshadkazi.ca/auth/token",
    "clientId": "alexa-stophop-skill",
    "clientSecret": "<generated-per-skill>",
    "scopes": ["voice_full"],
    "accessTokenScheme": "HTTP_BASIC"
  }
}
```

### 4.7 Lambda Environment Variables

```
STOPHOP_RELAY_URL=relay.arshadkazi.ca
NODE_ENV=production
```

**Cost:** AWS Lambda free tier covers 1M requests/month — more than sufficient for a family grocery list. **$0/month in practice.**

---

## 5. Google Assistant Integration (Recommended: Actions on Google + Webhooks)

### 5.1 Recommended Approach

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Actions Builder (conversational)** | Full NLU, natural phrases, proactive suggestions, free | More complex setup than Alexa | ✅ **RECOMMENDED** |
| Google Smart Home trait | Works with "Hey Google" natively | Limited to device-like entities, not lists | ❌ |
| Google Routines + IFTTT | Simple | Latency, third-party, no dynamic slots | ❌ |
| Dialogflow ES/CX | Powerful NLU | Extra service, billing for Dialogflow CX | ⚠️ Fallback |

### 5.2 Actions Builder Architecture

```
User: "Hey Google, talk to StopHop"
  ↓
Google Assistant Cloud (NLU)
  ↓
Google Cloud Function / Webhook
  ├── actions.intent.MAIN        → "Welcome to StopHop!"
  ├── actions.intent.ADD_ITEM    → POST /api/voice/add-item
  ├── actions.intent.READ_LIST   → POST /api/voice/read-list
  └── actions.intent.CHECK_ITEM  → POST /api/voice/check-item
  ↓
StopHop Relay Server (self-hosted)
  ↓
WebSocket → App → Yjs CRDT → Family sync
```

### 5.3 Action Package (`action.json`)

```json
{
  "actions": [
    {
      "name": "MAIN",
      "intent": {
        "name": "actions.intent.MAIN",
        "trigger": {
          "queryPatterns": [
            "talk to stop hop",
            "open stop hop",
            "ask stop hop"
          ]
        }
      },
      "fulfillment": {
        "conversationName": "mainConversation"
      }
    },
    {
      "name": "ADD_ITEM",
      "intent": {
        "name": "actions.intent.ADD_ITEM",
        "parameters": [
          {
            "name": "item",
            "type": "SchemaOrg_Text"
          },
          {
            "name": "quantity",
            "type": "SchemaOrg_Number"
          },
          {
            "name": "listName",
            "type": "SchemaOrg_Text"
          }
        ],
        "trigger": {
          "queryPatterns": [
            "add $SchemaOrg_Text:item",
            "add $SchemaOrg_Text:item to the list",
            "add $SchemaOrg_Text:item to $SchemaOrg_Text:listName",
            "put $SchemaOrg_Text:item on the list",
            "i need $SchemaOrg_Text:item",
            "buy $SchemaOrg_Text:item",
            "get $SchemaOrg_Text:item",
            "we need $SchemaOrg_Text:item"
          ]
        }
      },
      "fulfillment": {
        "conversationName": "mainConversation"
      }
    },
    {
      "name": "READ_LIST",
      "intent": {
        "name": "actions.intent.READ_LIST",
        "trigger": {
          "queryPatterns": [
            "what's on the list",
            "read the list",
            "what do i need",
            "what's on $SchemaOrg_Text:listName",
            "read my grocery list",
            "whats on the shopping list"
          ]
        }
      },
      "fulfillment": {
        "conversationName": "mainConversation"
      }
    },
    {
      "name": "CHECK_ITEM",
      "intent": {
        "name": "actions.intent.CHECK_ITEM",
        "parameters": [
          {
            "name": "item",
            "type": "SchemaOrg_Text"
          }
        ],
        "trigger": {
          "queryPatterns": [
            "check off $SchemaOrg_Text:item",
            "mark $SchemaOrg_Text:item as done",
            "i got $SchemaOrg_Text:item",
            "i bought $SchemaOrg_Text:item",
            "done with $SchemaOrg_Text:item",
            "cross off $SchemaOrg_Text:item"
          ]
        }
      },
      "fulfillment": {
        "conversationName": "mainConversation"
      }
    }
  ],
  "conversations": {
    "mainConversation": {
      "name": "mainConversation",
      "url": "https://us-central1-stophop-voice.cloudfunctions.net/stophopGoogleWebhook",
      "fulfillmentApiVersion": 2
    }
  },
  "locale": "en"
}
```

### 5.4 Google Cloud Function (Node.js)

```javascript
// functions/stophop-google/index.js

const { smarthome } = require('actions-on-google');
const https = require('https');

const RELAY_URL = process.env.STOPHOP_RELAY_URL;

/**
 * Make an authenticated request to the StopHop relay server.
 */
async function relayRequest(path, body, accessToken) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(`https://${RELAY_URL}${path}`);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid response' }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Conversation Handler ────────────────────────────────────────────────

const app = smarthome({ debug: true });

// Handle the welcome / MAIN intent
app.handle('MAIN', (conv) => {
  conv.ask(`Welcome to StopHop! You can say "add milk", ` +
    `"what's on the list", or "check off eggs". What would you like to do?`);
});

// Handle ADD_ITEM intent
app.handle('ADD_ITEM', async (conv) => {
  const item = conv.params.item;
  const quantity = parseInt(conv.params.quantity || '1', 10);
  const listName = conv.params.listName || null;
  const accessToken = conv.user.access.token;

  if (!item) {
    conv.ask("I didn't catch the item. What would you like to add?");
    return;
  }

  if (!accessToken) {
    conv.ask('Please link your StopHop account first. ' +
      'Open the Google Home app to set up account linking.');
    return;
  }

  // Clean item name
  const itemName = item
    .replace(/^(add|put|get|buy|need|want)\s+/i, '')
    .replace(/\s+(to|on|in|for)\s+(the\s+)?(list|grocery|shopping).*$/i, '')
    .trim();

  try {
    const result = await relayRequest('/api/voice/add-item', {
      item: { name: itemName, quantity, unit: 'each' },
      listName,
      source: 'google',
      timestamp: Date.now(),
    }, accessToken);

    if (result.success) {
      conv.ask(`Added ${itemName} to your grocery list.`);
    } else {
      conv.ask(`Sorry, I couldn't add ${itemName}. ${result.error || ''}`);
    }
  } catch (err) {
    console.error('Relay error:', err);
    conv.ask("Sorry, I couldn't reach your StopHop server. Is it running?");
  }
});

// Handle READ_LIST intent
app.handle('READ_LIST', async (conv) => {
  const listName = conv.params.listName || null;
  const accessToken = conv.user.access.token;

  if (!accessToken) {
    conv.ask('Please link your StopHop account first.');
    return;
  }

  try {
    const result = await relayRequest('/api/voice/read-list', {
      listName,
      source: 'google',
    }, accessToken);

    if (result.success && result.items?.length > 0) {
      const itemList = result.items.map(i => {
        const qty = i.quantity > 1 ? `${i.quantity} ` : '';
        return `${qty}${i.name}`;
      });

      let speech;
      if (itemList.length === 1) {
        speech = `You have one item: ${itemList[0]}.`;
      } else if (itemList.length <= 5) {
        const last = itemList.pop();
        speech = `You have ${result.items.length} items: ${itemList.join(', ')}, and ${last}.`;
      } else {
        speech = `You have ${result.items.length} items. ` +
          `First five: ${itemList.slice(0, 5).join(', ')}.`;
      }

      conv.ask(speech);
    } else {
      conv.ask("Your grocery list is empty. What would you like to add?");
    }
  } catch (err) {
    conv.ask("Sorry, I couldn't reach your StopHop server.");
  }
});

// Handle CHECK_ITEM intent
app.handle('CHECK_ITEM', async (conv) => {
  const item = conv.params.item;
  const accessToken = conv.user.access.token;

  if (!item || !accessToken) {
    conv.ask("Which item would you like to check off?");
    return;
  }

  try {
    const result = await relayRequest('/api/voice/check-item', {
      itemName: item,
      source: 'google',
      timestamp: Date.now(),
    }, accessToken);

    if (result.success) {
      conv.ask(`Checked off ${item}.`);
    } else {
      conv.ask(`I couldn't find "${item}" on your list.`);
    }
  } catch (err) {
    conv.ask("Sorry, I couldn't reach your StopHop server.");
  }
});

exports.stophopGoogleWebhook = app;
```

### 5.5 Account Linking Configuration (Actions Console)

```json
{
  "accountLinking": {
    "type": "AUTH_CODE",
    "grantType": "AUTHORIZATION_CODE",
    "authorizationUrl": "https://relay.arshadkazi.ca/auth/link",
    "tokenUrl": "https://relay.arshadkazi.ca/auth/token",
    "scopes": ["voice_full"]
  }
}
```

**Cost:** Google Cloud Functions free tier: 2M invocations/month. **$0/month in practice.**

---

## 6. Relay Server: New Endpoints

### 6.1 Endpoint Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/auth/link` | GET | None | OAuth linking page (HTML) |
| `/auth/authorize` | POST | Pairing code | Validate code, issue auth code |
| `/auth/token` | POST | Client credentials | Exchange auth code for access token |
| `/auth/revoke` | POST | Access token | Revoke token |
| `/api/voice/add-item` | POST | Bearer token | Add item to list |
| `/api/voice/read-list` | POST | Bearer token | Read list items |
| `/api/voice/check-item` | POST | Bearer token | Check off an item |

### 6.2 OAuth Endpoints

#### `GET /auth/link`

Serves an HTML form for account linking. This is what Google/Alexa opens in the user's browser.

```html
<!DOCTYPE html>
<html>
<head>
  <title>StopHop — Link Your Voice Assistant</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 400px; 
           margin: 60px auto; padding: 20px; }
    h1 { font-size: 24px; }
    input { width: 100%; padding: 12px; margin: 8px 0; font-size: 18px; 
            border: 1px solid #ccc; border-radius: 8px; box-sizing: border-box; }
    button { width: 100%; padding: 14px; background: #4CAF50; color: white; 
             border: none; border-radius: 8px; font-size: 18px; cursor: pointer; }
    button:hover { background: #45a049; }
    .error { color: red; margin: 8px 0; }
  </style>
</head>
<body>
  <h1>🛒 StopHop</h1>
  <p>Enter the 6-digit pairing code from your StopHop app to link your voice assistant.</p>
  
  <form id="linkForm">
    <input type="text" id="code" placeholder="000000" maxlength="6" 
           pattern="[0-9]{6}" required autocomplete="off">
    <input type="hidden" id="redirect_uri" name="redirect_uri">
    <input type="hidden" id="state" name="state">
    <button type="submit">Link Account</button>
  </form>
  
  <div id="error" class="error"></div>

  <script>
    // Extract OAuth params from URL
    const params = new URLSearchParams(window.location.search);
    document.getElementById('redirect_uri').value = params.get('redirect_uri') || '';
    document.getElementById('state').value = params.get('state') || '';

    document.getElementById('linkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('code').value;
      const redirectUri = document.getElementById('redirect_uri').value;
      const state = document.getElementById('state').value;

      try {
        const res = await fetch('/auth/authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: redirectUri, state }),
        });
        const data = await res.json();

        if (data.success && data.redirect_url) {
          window.location.href = data.redirect_url;
        } else {
          document.getElementById('error').textContent = 
            data.error || 'Invalid code. Please try again.';
        }
      } catch (err) {
        document.getElementById('error').textContent = 'Connection failed.';
      }
    });
  </script>
</body>
</html>
```

#### `POST /auth/authorize`

```javascript
// Validates pairing code, issues authorization code, returns redirect URL
{
  code: string,           // 6-digit pairing code
  redirect_uri: string,   // OAuth redirect URI (Google/Alexa callback)
  state: string           // OAuth state parameter
}

// Response:
{
  success: true,
  redirect_url: "https://oauth-redirect.googleusercontent.com/r/YOUR_PROJECT_ID?code=AUTH_CODE&state=STATE"
}
```

#### `POST /auth/token`

```javascript
// Exchanges authorization code for access token (standard OAuth 2.0)
{
  grant_type: "authorization_code",
  code: string,
  client_id: string,
  client_secret: string,
  redirect_uri: string
}

// Response:
{
  access_token: string,
  token_type: "Bearer",
  expires_in: 31536000,   // 1 year (re-auth via app)
  scope: "voice_full"
}
```

### 6.3 Voice API Endpoints

#### `POST /api/voice/add-item`

```javascript
// Request (authenticated via Bearer token from OAuth)
{
  item: {
    name: "milk",
    quantity: 1,
    unit: "each"
  },
  listName: "Costco list",   // optional — defaults to primary list
  source: "alexa" | "google",
  timestamp: 1718456789000
}

// Response:
{
  success: true,
  itemId: "generated-uuid",
  listId: "list-xyz789",
  itemCount: 12,              // total unchecked items on list
  message: "Added milk to your grocery list"
}
```

#### `POST /api/voice/read-list`

```javascript
// Request
{
  listName: "grocery",        // optional — defaults to primary list
  source: "alexa" | "google"
}

// Response:
{
  success: true,
  listName: "My Grocery List",
  items: [
    { name: "milk", quantity: 2, unit: "each", category: "dairy" },
    { name: "bread", quantity: 1, unit: "each", category: "bakery" },
    { name: "eggs", quantity: 12, unit: "each", category: "dairy" }
  ],
  totalItems: 3,
  checkedItems: 5
}
```

#### `POST /api/voice/check-item`

```javascript
// Request
{
  itemName: "milk",
  source: "alexa" | "google",
  timestamp: 1718456789000
}

// Response:
{
  success: true,
  matchedItem: "milk",
  message: "Checked off milk"
}
```

### 6.4 Token Validation Middleware

```javascript
// Shared middleware for all /api/voice/* endpoints

const voiceTokens = new Map(); // token → { familyId, scope, createdAt }

function validateVoiceToken(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing authorization token' }));
    return null;
  }

  const token = authHeader.slice(7);
  const tokenData = voiceTokens.get(token);

  if (!tokenData) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or expired token' }));
    return null;
  }

  return tokenData; // { familyId, scope }
}
```

### 6.5 Fuzzy Item Matching (for check-item)

```javascript
/**
 * Find the best matching item on the list using Levenshtein distance.
 * Voice recognition may produce "melk" instead of "milk".
 */
function findBestMatch(itemName, listItems) {
  const normalizedName = itemName.toLowerCase().trim();
  
  // Exact match first
  const exact = listItems.find(i => 
    i.name.toLowerCase() === normalizedName && !i.isChecked
  );
  if (exact) return exact;

  // Substring match
  const substring = listItems.find(i =>
    i.name.toLowerCase().includes(normalizedName) && !i.isChecked
  );
  if (substring) return substring;

  // Levenshtein distance (threshold: 2 edits or 30% of length)
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const item of listItems) {
    if (item.isChecked) continue;
    const dist = levenshtein(normalizedName, item.name.toLowerCase());
    const threshold = Math.max(2, Math.floor(item.name.length * 0.3));
    if (dist < threshold && dist < bestDistance) {
      bestDistance = dist;
      bestMatch = item;
    }
  }

  return bestMatch;
}
```

---

## 7. Security Model

### 7.1 Authentication Layers

```
Layer 1: OAuth 2.0 Account Linking
  └── User proves family membership via pairing code
  └── Google/Amazon store access tokens per user
  └── Tokens scoped to voice_read / voice_write / voice_full

Layer 2: Bearer Token Validation
  └── Every /api/voice/* request carries Authorization: Bearer <token>
  └── Relay validates token → resolves familyId
  └── Token rotation: app can revoke and re-issue tokens

Layer 3: HMAC-SHA256 Request Signing (optional, for Lambda→Relay)
  └── Lambda/Cloud Function signs the request body
  └── Relay verifies HMAC with shared secret
  └── Prevents token replay from different Lambda invocations

Layer 4: Rate Limiting
  └── Per-family: 30 voice items/minute
  └── Per-token: 60 requests/minute
  └── Global: 200 requests/minute (DDoS protection)

Layer 5: TLS
  └── All endpoints served over HTTPS
  └── Cloudflare Tunnel or direct TLS termination
```

### 7.2 E2E Encryption Preservation

Same approach as the HA integration — the relay server handles plaintext items from voice webhooks but **never stores the E2E encryption key**:

```
Voice Speaker (plaintext speech)
  ↓
Google/Alexa Cloud (plaintext NLU output)
  ↓
Lambda/Cloud Function (plaintext item)
  ↓
Relay Server (plaintext → voice queue)
  ↓
WebSocket push (plaintext to connected app)
  ↓
APP: encrypt with master key → Yjs CRDT merge → encrypted sync
  ↓
Other family devices (encrypted)
```

**Trade-off:** The Lambda/Cloud Function and relay briefly see plaintext item names. This is inherent to any voice assistant integration — the voice platform must understand the words. The relay doesn't persist plaintext; it passes it through.

### 7.3 Token Lifecycle

```
┌─────────────────────────────────────────────────────────┐
│                    TOKEN LIFECYCLE                       │
│                                                         │
│  1. App generates voice pairing code (6-digit, 10min)   │
│  2. User enters code on OAuth linking page              │
│  3. Relay issues authorization code (single-use, 5min)  │
│  4. Google/Alexa exchanges code → access token (1 year) │
│  5. Token stored by Google/Amazon per user              │
│  6. User can revoke via StopHop app Settings            │
│  7. App can bulk-revoke all voice tokens                │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Implementation Roadmap

### Phase 1: Relay Server OAuth + Voice Endpoints (1–2 weeks)

| Task | Effort | Files |
|------|--------|-------|
| OAuth linking page (`/auth/link`) | 4h | `relay-server/auth/link.html` |
| OAuth authorize endpoint (`/auth/authorize`) | 4h | `relay-server/auth/oauth.js` |
| OAuth token endpoint (`/auth/token`) | 4h | `relay-server/auth/oauth.js` |
| Token storage + validation | 3h | `relay-server/auth/tokens.js` |
| `POST /api/voice/add-item` (refine existing) | 2h | `relay-server/server.js` |
| `POST /api/voice/read-list` (NEW) | 4h | `relay-server/voice/read-list.js` |
| `POST /api/voice/check-item` (NEW) | 4h | `relay-server/voice/check-item.js` |
| Fuzzy item matching | 3h | `relay-server/voice/matcher.js` |
| Rate limiting (per-token) | 2h | `relay-server/auth/rate-limit.js` |
| Tests | 4h | `relay-server/__tests__/voice.test.js` |
| **Subtotal** | **~34h** | |

### Phase 2: Alexa Skill (1 week)

| Task | Effort |
|------|--------|
| Skill interaction model JSON | 3h |
| Lambda handler (add/read/check) | 6h |
| Account linking config | 2h |
| Testing with Alexa Simulator | 3h |
| Beta testing on real Echo device | 2h |
| Skill submission (optional, for public) | 2h |
| **Subtotal** | **~18h** |

### Phase 3: Google Action (1 week)

| Task | Effort |
|------|--------|
| Action package (`action.json`) | 3h |
| Cloud Function handler | 6h |
| Account linking config | 2h |
| Testing with Google Simulator | 3h |
| Beta testing on real Nest device | 2h |
| Action submission (optional) | 2h |
| **Subtotal** | **~18h** |

### Phase 4: App-Side Integration (1 week)

| Task | Effort |
|------|--------|
| Voice pairing code generation UI | 4h |
| Token management (list, revoke) | 3h |
| Settings screen: Voice Assistants section | 3h |
| Pull voice items on connect (existing) | 0h (already designed) |
| `voice_item` WebSocket handler (existing) | 0h (already designed) |
| End-to-end testing | 4h |
| **Subtotal** | **~14h** |

### Total: ~84 hours (4–6 weeks part-time)

---

## 9. Relay Server File Structure

```
relay-server/
├── server.js                    # Main server (existing)
├── auth/
│   ├── link.html                # OAuth linking page
│   ├── oauth.js                 # OAuth authorize + token endpoints
│   ├── tokens.js                # Token storage + validation
│   └── pairing-codes.js         # Pairing code generation + validation
├── voice/
│   ├── add-item.js              # POST /api/voice/add-item
│   ├── read-list.js             # POST /api/voice/read-list
│   ├── check-item.js            # POST /api/voice/check-item
│   ├── matcher.js               # Fuzzy item matching
│   └── queue.js                 # Voice item queue (existing concept)
├── lambda/
│   ├── stophop-alexa/           # Alexa Lambda function
│   │   ├── index.js
│   │   ├── package.json
│   │   └── skill.json           # Interaction model
│   └── stophop-google/          # Google Cloud Function
│       ├── index.js
│       ├── package.json
│       └── action.json          # Action package
├── __tests__/
│   ├── voice.test.js            # Voice endpoint tests
│   ├── oauth.test.js            # OAuth flow tests
│   └── matcher.test.js          # Fuzzy matching tests
└── package.json
```

---

## 10. Comparison: HA-Hub vs. Direct Integration

| Aspect | HA Hub (existing doc) | Direct (this doc) |
|--------|----------------------|-------------------|
| **Prerequisites** | Home Assistant running | Just the relay server |
| **Target audience** | Smart home enthusiasts | Any household |
| **Complexity** | Low (HA handles voice) | Medium (OAuth + Lambda) |
| **Cost** | $0 (HA free) | $0 (Lambda/Functions free tier) |
| **Maintenance** | HA + relay server | Lambda + relay server |
| **Voice latency** | HA → Relay (2 hops) | Lambda → Relay (1 hop) |
| **Privacy** | HA sees plaintext | Lambda sees plaintext |
| **Customization** | HA automations | Full control in Lambda |
| **Can coexist?** | ✅ Yes — both can run simultaneously | ✅ Yes |

**Recommendation:** Implement both. HA hub for Arshad's home, direct integration for sharing with family/friends who don't have HA.

---

## 11. Migration Path

### Step 1: Build Relay OAuth + Voice Endpoints
The endpoints work for both HA-hub and direct integrations. HA can use a static API key instead of OAuth.

### Step 2: Build Lambda/Cloud Function
Deploy alongside the existing relay. Test with Alexa Simulator / Google Simulator.

### Step 3: Update App Settings Screen
Add a "Voice Assistants" section with:
- Alexa: "Link Alexa" button → opens OAuth page
- Google: "Link Google Assistant" button → opens OAuth page
- Existing HA integration (API key based)

### Step 4: Beta Test on Real Devices
Test on Echo Dot and Google Nest Mini in the home.

### Step 5: Optional — Publish Skills
Submit Alexa skill and Google Action for public listing (takes 1–2 weeks for review).

---

## 12. Future Enhancements

1. **Proactive notifications:** "Alexa, tell StopHop to remind me about the list when I leave home" (requires Alexa Proactive Events API).
2. **Multi-turn dialog:** "Add milk" → "How much?" → "Two gallons" (both platforms support this).
3. **Voice biometrics:** Recognize which family member is speaking (Alexa Voice Profiles, Google Voice Match) → set `addedBy` automatically.
4. **Smart suggestions:** "You usually buy eggs on Mondays. Want me to add them?"
5. **Store-aware lists:** "Add items for Costco" → routes to store-specific list.
6. **Apple HomePod / Siri:** Siri Shortcuts integration via existing `src/voice/siri.ts` pattern.
7. **Samsung Bixby:** Bixby Capsule with similar architecture.
8. **Offline voice:** If relay is unreachable, queue items locally on Lambda and retry.

---

## 13. Appendix: Existing Code Reuse

| Existing Component | Reuse For |
|-------------------|-----------|
| `src/voice/ifttt.ts` — HMAC signing | Reuse `signRequest()` and `verifySignature()` for Lambda→Relay signing |
| `src/voice/nlp.ts` — Item parser | Run on Lambda for server-side NLP fallback |
| Voice queue concept (from HA doc) | Same queue serves both HA and direct integrations |
| `voice_item` WebSocket message | Same message type, same app handler |
| Rate limiting pattern (server.js) | Extend existing per-family rate limiter to per-token |
