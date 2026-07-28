# GroceryApp Architecture

## Overview

A cross-platform (iOS + Android) family grocery list app built with **React Native (Expo + TypeScript)**. End-to-end encrypted, offline-first, privacy by default, with **CRDT-based real-time sync** via Yjs.

---

## Architecture Decisions

### 1. Yjs CRDT Sync (Phase 2)

**Choice:** [Yjs](https://github.com/yjs/yjs) (v13) — Conflict-Free Replicated Data Types

**Rationale:**
- **Automatic conflict resolution:** Yjs uses internal CRDT algorithms that handle concurrent edits from multiple family members without conflicts
- **Real-time collaboration:** Changes are shared instantly via WebSocket relay
- **Offline support:** Yjs documents can be modified offline and synced when reconnected
- **No central database:** The relay server is ephemeral — Yjs documents live on the clients
- **Encrypted updates:** Yjs updates are encrypted with libsodium before sending over WebSocket

**How it works:**

```
Client A (Mom)              Relay Server              Client B (Dad)
     │                           │                        │
     ├── encrypt(update) ──────► │                        │
     │       (XChaCha20-Poly1305)│                        │
     │                           ├── decrypt─────────────►│
     │                           │   (relay can't read)   │
     │                           │                        │
     │                           │◄── encrypt(update) ────┤
     │◄──── decrypt──────────────┤                        │
```

**Yjs shared types per grocery list:**
- `yMap('meta')` — list metadata (name, description, storePreference, timestamps)
- `yArray('items')` — array of `yMap` objects, each representing a grocery item
- `yMap('awareness')` — real-time presence tracking for family members

**Offline queue:**
- When disconnected, pending Yjs updates are stored in an in-memory queue
- On reconnection, the queue is flushed in order
- The queue is not persisted to disk (Phase 3+ may add persistent offline queue)

---

### 2. WebSocket Relay Server (Phase 2)

**Choice:** Node.js + `ws` library — standalone relay server at `relay-server/server.js`

**Design principles:**
- **Zero-knowledge:** The relay only forwards encrypted blobs — it cannot read content
- **Ephemeral:** No message persistence — Yjs documents live entirely on clients
- **Family-based rooms:** Clients join a room by `familyId`; messages are relayed to all other room members
- **Health check & stats:** HTTP endpoints at `/health` and `/stats`

**REST endpoints:**
- `GET /health` — health check
- `GET /stats` — family room statistics
- `POST /enroll` — device enrollment (future: device key exchange)

**Docker deployment:** `docker-compose.yml` at project root runs the relay on port 8080.

---

### 3. libsodium XChaCha20-Poly1305 + Argon2id (Phase 2)

**Choice:** `libsodium-wrappers` (XChaCha20-Poly1305 AEAD + Argon2id KDF)

**Replaces:** `expo-crypto` AES-256-GCM + PBKDF2-HMAC-SHA256 (Phase 1)

**Rationale:**
- **XChaCha20-Poly1305** is a modern AEAD cipher with 24-byte nonces (vs 12-byte for AES-GCM), eliminating nonce collision concerns even with random nonce generation
- **Argon2id** is the industry-standard memory-hard KDF (winner of the PHC), resistant to GPU/ASIC parallel attacks, replacing PBKDF2 which is vulnerable to hardware-accelerated brute-force
- **libsodium-wrappers** provides a JS-only fallback that works in React Native without native modules
- AAD (Additional Authenticated Data) is supported natively by libsodium's AEAD interface

**How it works:**

```
Family Passphrase
       │
       ▼  crypto_pwhash (Argon2id, OPSLIMIT_MODERATE / MEMLIMIT_MODERATE)
       ▼
   Master Key (256-bit)
       │  stored in expo-secure-store
       │  passphrase NEVER persisted
       ▼
   XChaCha20-Poly1305 per-field encryption
       │  fresh random nonce (24 bytes) per encryption
       │  AAD binds ciphertext to field context
       ▼
   EncryptedData { ciphertext, nonce, tag }
       │  stored in WatermelonDB as base64 strings
```

**Key properties:**
- **Zero-knowledge:** Servers only see ciphertext — never plaintext content
- **Passphrase-derived:** Family shares a passphrase to derive the same key
- **Secure Store:** Master key lives in OS keychain (expo-secure-store)
- **Integrity:** XChaCha20-Poly1305 auth tag prevents tampering
- **AAD:** Each ciphertext is cryptographically bound to its field context
- **Memory-hard KDF:** Argon2id requires significant memory, resisting GPU/ASIC attacks
- **Constant-time verification:** Uses `sodium.memcmp` for passphrase verification

---

### 4. WatermelonDB for Offline-First Persistence

**Choice:** [WatermelonDB](https://github.com/Nozbe/WatermelonDB) (v0.28)

**Rationale:**
- SQLite-backed with lazy loading — only loads records when observed
- Built-in observable queries via RxJS — UI updates automatically when data changes
- Designed for offline-first with a sync protocol out of the box
- Type-safe schema via model classes
- Native performance (JSI bridge on iOS/Android)

**Schema:**
Three tables defined in `src/storage/schema.ts`:
- `grocery_lists` — list metadata (name, store preference, soft-delete columns)
- `grocery_items` — individual items within a list (with `family_id` column)
- `family_members` — user roster for a family group (with soft-delete columns)

**Migrations:**
Defined in `src/storage/migrations.ts`. Schema version 1 → 2 adds:
- `family_id` column to `grocery_items`
- `is_deleted` and `deleted_at` columns to `grocery_lists` and `family_members`

**Phase 2 change:** WatermelonDB is now a **persistence layer** beneath Yjs. Yjs is the source of truth for sync; WatermelonDB provides local persistence. Changes flow:

```
Yjs Document (CRDT)
   │
   ├──► WebSocket Relay (encrypted)
   │
   └──► WatermelonDB (encrypted persistence)
```

---

### 5. Soft Deletes (Standardized)

All three entity types (`GroceryItem`, `GroceryList`, `FamilyMember`) use consistent soft-delete fields:

- `isDeleted: boolean` — whether the record is logically deleted
- `deletedAt: number | null` — timestamp of deletion

**Why:**
- Sync needs to know what was deleted (tombstones)
- Undo is possible
- Conflict resolution is simpler

**Flow:**
1. User "deletes" → `isDeleted = true`, `syncStatus = 'deleted'`
2. Sync pushes tombstone to server
3. Server acknowledges → record can be permanently removed
4. If offline, deletion is queued and pushed when online

---

### 6. Hydration & Persistence (Phase 2 Updated)

**Pattern:** `src/storage/hydrate.ts` + `src/sync/sync-manager.ts`

Phase 2 changes the data flow from a simple write-through to a **Yjs-mediated** architecture:

```
                    App Startup
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
  WatermelonDB ──decrypt──► Yjs Document (hydrate)
         ▲                               │
         │                               ├──► WebSocket relay
         │                               │    (encrypted CRDT updates)
         │                               │
         │                               └──► persist to WatermelonDB
         │                                    (via SyncManager observer)
         │
    Every Yjs mutation
    triggers WatermelonDB persist
```

**Hydration (app start):**
1. Load master key from SecureStore
2. Read all records from WatermelonDB
3. Decrypt sensitive fields using AAD context
4. Hydrate Yjs documents
5. Connect WebSocket relay
6. Register list observers for sync

**Persistence (every Yjs change):**
1. Yjs `update` event fires
2. SyncManager encrypts the update and sends via WebSocket
3. SyncManager persists current Yjs state to WatermelonDB

**Sensitive fields encrypted per entity:**
- **GroceryItem:** `name`, `notes`
- **GroceryList:** `name`, `description`, `storePreference`
- **FamilyMember:** `displayName`

---

### 7. State Management

**Choice:** [Zustand](https://github.com/pmndrs/zustand)

**Rationale:**
- Minimal boilerplate compared to Redux
- Works well with React Native
- Easy to connect Yjs document observers to store updates
- Supports middleware for persistence, devtools, etc.

**Stores:**
- `useGroceryStore` — items CRUD (via Yjs shared types, with WatermelonDB persistence)
- `useListStore` — lists CRUD (via Yjs shared types, with WatermelonDB persistence)
- `useFamilyStore` — members CRUD (via Yjs shared types, with WatermelonDB persistence)
- `useSyncStore` — sync state machine (connection status, pending queue, etc.)

**ID Generation:**
All entity IDs are UUID v4 strings generated via libsodium's `randombytes_buf`, replacing the previous `expo-crypto`-based generation.

---

### 8. Extensible Categories

Categories are now a `string` type (`GroceryCategory = string`) instead of a closed union.

Built-in categories are provided as constants in `BUILT_IN_CATEGORIES`:
`produce`, `dairy`, `meat`, `bakery`, `frozen`, `pantry`, `beverages`, `other`

Users can define custom categories without modifying the type system. The WatermelonDB schema stores categories as plaintext strings, making custom categories queryable.

---

## Folder Structure

```
src/
├── types/          # TypeScript type definitions
│   └── index.ts
├── crypto/         # libsodium XChaCha20-Poly1305 AEAD + Argon2id KDF (replaced expo-crypto)
│   └── index.ts
├── storage/        # WatermelonDB persistence layer (below Yjs in Phase 2)
│   ├── schema.ts
│   ├── models.ts
│   ├── database.ts
│   ├── migrations.ts
│   └── hydrate.ts      # Encryption + WatermelonDB read/write
├── sync/           # Yjs CRDT sync layer (Phase 2)
│   ├── yjs-adapter.ts      # Yjs document management, shared types, mutations
│   ├── y-websocket.ts      # WebSocket client with encrypted relay + offline queue
│   └── sync-manager.ts     # Coordinates Yjs ↔ WebSocket ↔ WatermelonDB
├── state/          # Zustand state stores (connected to Yjs documents)
│   ├── useGroceryStore.ts
│   ├── useListStore.ts
│   ├── useFamilyStore.ts
│   └── useSyncStore.ts
├── screens/        # Screen components (stubs)
│   └── HomeScreen.tsx
└── components/     # Reusable UI components (stubs)
    └── Placeholder.tsx

relay-server/       # Zero-knowledge WebSocket relay (Node.js)
├── server.js       # Relay server implementation
├── package.json
└── Dockerfile

docker-compose.yml  # Docker Compose for relay server deployment
```

---

## Security Design

### Threat Model
- **Server compromise:** Server is zero-knowledge — only encrypted data is relayed. The relay cannot read Yjs update contents.
- **Device theft:** Master key is in SecureStore (hardware-backed on modern devices)
- **Network eavesdropping:** All Yjs updates are end-to-end encrypted with XChaCha20-Poly1305 before WebSocket transmission
- **Ciphertext relocation:** AAD prevents moving ciphertext between fields or records
- **Timing attacks:** `sodium.memcmp` provides constant-time comparison for passphrase verification
- **Side-channel via KDF:** Argon2id (OPSLIMIT_MODERATE / MEMLIMIT_MODERATE) is memory-hard, making brute-force computationally and memory-expensive
- **Nonce collision:** XChaCha20-Poly1305 uses 24-byte nonces, allowing random nonce generation without collision risk (vs 12-byte nonces in AES-GCM)

### What IS stored on device
- Master key + salt (in expo-secure-store, encrypted at rest)
- Ciphertext in WatermelonDB
- Metadata (ids, timestamps, sync status) — not sensitive

### What is NEVER stored on device
- Family passphrase (used only at setup/login to derive key)
- Plaintext content after decryption is consumed and discarded

---

## Offline Queue Behavior

1. **Disconnected:** Yjs updates are enqueued in memory (`offlineQueue`)
2. **Reconnection:** On WebSocket open, the queue is flushed in FIFO order
3. **Partial flush:** If a send fails mid-flush, remaining entries stay queued
4. **Monitoring:** `useSyncStore.pendingUploads` reflects queue length
5. **Persistence (future):** The offline queue is currently in-memory only. Phase 3+ may persist to AsyncStorage for app-restart tolerance.

---

## Phases

| Phase | Feature |
|-------|---------|
| 1     | ✅ Project scaffold, types, crypto (AES-256-GCM + PBKDF2), storage, state, ARCHITECTURE |
| 2     | ✅ Yjs CRDT sync, libsodium XChaCha20-Poly1305 + Argon2id, relay server, offline queue |
| 3     | UI screens, navigation, item management |
| 4     | Voice input (opt-in), store integrations (opt-in) |
| 5     | Claude API for smart suggestions (opt-in) |