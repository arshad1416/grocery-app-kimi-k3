/**
 * M6 — the persistence failures that were still silent.
 *
 * persist-error-surfacing.test.ts covers the two `persistListToDB(...).catch`
 * sites. But those catches can only fire if persistListToDB actually rejects,
 * and its first line used to be `if (!this.encryptionKey) return;` — a clean
 * resolve. registerList() is called ungated from the stores while the key is
 * only set by init()/hydrateFromDB(), so the ordering that loses every write
 * is exactly the ordering that produced no signal at all.
 *
 * Three more paths were swallowed outright:
 *  - a queue row whose payload is unusable was `continue`d, so it was neither
 *    loaded nor deleted and the offline_queue table grew without bound;
 *  - entries dropped on restore because they no longer decrypt vanished with
 *    only a console line;
 *  - a failed disk write of a queued update was caught into `() => {}`.
 *
 * Run: npx jest __tests__/sync-failure-surfacing.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import sodium from 'libsodium-wrappers';

// Toggleable database failure — `mock` prefix so Jest's factory hoisting
// allows the reference.
let mockDbFails = false;
jest.mock('../src/storage/database', () => {
  const actual: any = jest.requireActual('../src/storage/database');
  return {
    ...actual,
    getDatabase: () => {
      if (mockDbFails) throw new Error('database closed');
      return actual.getDatabase();
    },
  };
});

jest.mock('../src/storage/hydrate', () => ({
  persistList: jest.fn(() => Promise.resolve()),
  persistItem: jest.fn(() => Promise.resolve()),
  loadItemsFromDB: jest.fn(() => Promise.resolve([])),
  loadListsFromDB: jest.fn(() => Promise.resolve([])),
}));

import { SyncManager } from '../src/sync/sync-manager';
import { useSyncStore } from '../src/state/useSyncStore';
import { hydrateList, yjsAddItem, destroyDoc } from '../src/sync/yjs-adapter';
import { loadQueueEntries } from '../src/sync/offline-queue-store';
import { YjsWebSocketClient, MAX_QUEUE_SIZE } from '../src/sync/y-websocket';
import { getDatabase } from '../src/storage/database';
import type { GroceryItem, GroceryList } from '../src/types';

const { _resetDB, _getTable } = require('@nozbe/watermelondb') as any;

const settle = () => new Promise((r) => setTimeout(r, 60));

class NoopWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState: number = NoopWebSocket.CLOSED;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  constructor(_url: string) {}
  send(_data: string): void {}
  close(): void {}
}

function makeList(id: string): GroceryList {
  const now = Date.now();
  return {
    id,
    familyId: 'fam-m6',
    name: 'Silent Failures',
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

function makeItem(id: string, listId: string): GroceryItem {
  const now = Date.now();
  return {
    id,
    listId,
    familyId: 'fam-m6',
    name: 'Rye Bread',
    quantity: 1,
    unit: 'loaf',
    category: 'bakery',
    isChecked: false,
    addedBy: 'member-1',
    sortOrder: 0,
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  mockDbFails = false;
  _resetDB();
  useSyncStore.setState({ syncState: 'not_configured', error: null });
});

afterEach(() => {
  mockDbFails = false;
  delete (globalThis as any).WebSocket;
});

describe('a local edit with no encryption key is reported, not dropped', () => {
  it('sets the user-visible error state instead of resolving silently', async () => {
    const listId = 'm6-no-key';
    destroyDoc(listId);
    const manager = new SyncManager();

    // registerList() without init()/hydrateFromDB() — the ungated ordering the
    // stores actually produce. No key means nothing can be written to disk.
    hydrateList(listId, makeList(listId), []);
    manager.registerList(listId);

    yjsAddItem(listId, makeItem('m6-item-1', listId));
    await settle();

    const state = useSyncStore.getState();
    expect(state.syncState).toBe('error');
    expect(state.error).toBe("Couldn't save recent changes to this device");
  });
});

describe('unusable offline-queue rows are deleted, not skipped forever', () => {
  it('drops a row whose stored payload is not a complete envelope', async () => {
    const db: any = getDatabase();
    await db.write(async () => {
      await db.get('offline_queue').create((r: any) => {
        r.listId = 'm6-corrupt';
        r.payload = JSON.stringify({ iv: 'aaaa', tag: 'bbbb' }); // no ciphertext
        r.createdAt = Date.now();
      });
      await db.get('offline_queue').create((r: any) => {
        r.listId = 'm6-unparseable';
        r.payload = 'not-json-at-all';
        r.createdAt = Date.now();
      });
    });
    expect(_getTable('offline_queue').size).toBe(2);

    const entries = await loadQueueEntries();
    expect(entries).toHaveLength(0);
    await settle();

    // Nothing usable is left behind to be re-scanned on every launch.
    const live = Array.from(_getTable('offline_queue').values() as any[])
      .filter((r) => !r._raw?.isDeleted);
    expect(live).toHaveLength(0);
  });
});

describe('offline-queue failures reach the sync error callback', () => {
  it('reports entries dropped on restore because they no longer decrypt', async () => {
    await sodium.ready;
    (globalThis as any).WebSocket = NoopWebSocket;
    const keyA = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const keyB = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const config = {
      url: 'ws://localhost:9997',
      familyId: 'fam-m6',
      deviceId: 'device-m6',
      allowUnauthenticated: true,
    };

    const clientA = new YjsWebSocketClient({ ...config, encryptionKey: keyA } as any);
    await clientA.init();
    clientA.sendUpdate('m6-list', new TextEncoder().encode('written-under-key-a'));
    await settle();
    clientA.disconnect();

    // Family reset: the key changed, so the persisted entry is unreadable.
    const errors: Error[] = [];
    const clientB = new YjsWebSocketClient({ ...config, encryptionKey: keyB } as any);
    clientB.onError = (err) => errors.push(err);
    await clientB.init();
    await settle();

    expect(errors.some((e) => /1 .*(queued|pending|offline).*(discard|drop)/i.test(e.message)))
      .toBe(true);
    clientB.disconnect();
  });

  it('reports a queued update that could not be written to disk', async () => {
    await sodium.ready;
    (globalThis as any).WebSocket = NoopWebSocket;
    const errors: Error[] = [];
    const client = new YjsWebSocketClient({
      url: 'ws://localhost:9997',
      familyId: 'fam-m6',
      deviceId: 'device-m6',
      encryptionKey: sodium.crypto_aead_xchacha20poly1305_ietf_keygen(),
      allowUnauthenticated: true,
    } as any);
    await client.init();
    client.onError = (err) => errors.push(err);

    mockDbFails = true;
    client.sendUpdate('m6-list', new TextEncoder().encode('never-reaches-disk'));
    await settle();
    mockDbFails = false;

    // The in-memory queue still holds it, but the user must learn that this
    // edit will not survive an app kill.
    expect(client.getPendingCount()).toBe(1);
    expect(errors.some((e) => /disk|persist/i.test(e.message))).toBe(true);
    client.disconnect();
  });

  it('does not orphan the disk row of an entry evicted before its write landed', async () => {
    await sodium.ready;
    (globalThis as any).WebSocket = NoopWebSocket;
    const client = new YjsWebSocketClient({
      url: 'ws://localhost:9997',
      familyId: 'fam-m6',
      deviceId: 'device-m6',
      encryptionKey: sodium.crypto_aead_xchacha20poly1305_ietf_keygen(),
      allowUnauthenticated: true,
    } as any);
    await client.init();

    // The whole loop runs before a single save resolves, so the evicted entry
    // has no row id yet at eviction time. Its write still lands afterwards —
    // and restorePersistedQueue stops at MAX_QUEUE_SIZE, so a row left behind
    // here is never restored and never deleted.
    for (let i = 0; i <= MAX_QUEUE_SIZE; i++) {
      client.sendUpdate('m6-evict', new TextEncoder().encode(`edit-${i}`));
    }
    expect(client.getPendingCount()).toBe(MAX_QUEUE_SIZE);

    await settle();
    await settle();
    expect(await loadQueueEntries()).toHaveLength(MAX_QUEUE_SIZE);
    client.disconnect();
  }, 30_000);
});
