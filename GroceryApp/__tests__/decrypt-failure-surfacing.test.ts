/**
 * A ciphertext that fails its authentication tag must reach the user.
 *
 * Poly1305 rejects with probability ~1-2^-128 unless the key is genuinely
 * wrong, so an AEAD failure means one thing in practice: this device's key is
 * not the key the data was written under. It is the single sync fault that
 * gets WORSE while unnoticed — the device keeps encrypting local edits under
 * the wrong key and pushing them into the family's stream, where the relay
 * retains and replays them for 30 days.
 *
 * Three separate things conspired to hide it:
 *
 *   1. y-websocket's 'update' case had no local try/catch, so the throw
 *      unwound to the generic onmessage handler and became a console.warn.
 *   2. bootstrap's onSyncError wrote `error` but not `syncState`, and
 *      SyncIndicator only renders `error` when syncState === 'error'. So even
 *      errors that DID reach the store were never displayed.
 *   3. setConnectionState derives syncState from the socket, so anything
 *      written there is erased by the next successful connect — and a
 *      wrong-key device connects perfectly.
 *
 * Net effect: the indicator said "Synced" while every incoming message was
 * discarded. These tests assert the RENDERED label, not merely that a store
 * field moved — a store-only assertion is exactly what passes while the user
 * still sees "Synced".
 *
 * Sibling: sync-failure-surfacing.test.ts covers the OUTBOUND persistence
 * failures (M6). This file covers the inbound decrypt path.
 *
 * Run: npx jest __tests__/decrypt-failure-surfacing.test.ts
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import sodium from 'libsodium-wrappers';

import { YjsWebSocketClient } from '../src/sync/y-websocket';
import { useSyncStore, syncIndicatorStatus } from '../src/state/useSyncStore';
import { DecryptFailureError, encrypt, initCrypto } from '../src/crypto';
import { decryptField, __resetHydrateFailureReporting } from '../src/storage/hydrate';

const KEY_A = new Uint8Array(32).fill(1);
const KEY_B = new Uint8Array(32).fill(2);

/** An envelope this client cannot possibly authenticate. */
const garbledEnvelope = () => ({
  ciphertext: sodium.to_base64(new Uint8Array(48).fill(9), sodium.base64_variants.ORIGINAL),
  iv: sodium.to_base64(new Uint8Array(24).fill(3), sodium.base64_variants.ORIGINAL),
  tag: sodium.to_base64(new Uint8Array(16).fill(7), sodium.base64_variants.ORIGINAL),
});

function makeClient() {
  const client = new YjsWebSocketClient({
    url: 'ws://localhost:19998',
    familyId: 'fam',
    deviceId: 'dev',
    encryptionKey: KEY_A,
  });
  const errors: Error[] = [];
  const applied: string[] = [];
  client.onError = (e) => errors.push(e);
  client.onRemoteUpdate = (listId) => applied.push(listId);
  // handleMessage is private; driving it directly is the point — it is the
  // function the socket calls, and there is no relay in this suite.
  const deliver = (msg: unknown) => (client as any).handleMessage(msg);
  return { client, errors, applied, deliver };
}

beforeEach(async () => {
  await sodium.ready;
  await initCrypto();
  useSyncStore.setState({
    syncState: 'not_configured',
    connectionState: 'disconnected',
    error: null,
    decryptFailures: 0,
    lastDecryptContext: null,
    lastSyncedAt: null,
  });
  __resetHydrateFailureReporting();
});

describe('an undecryptable update is reported, not discarded', () => {
  it('reports a DecryptFailureError and does not apply the update', async () => {
    const { errors, applied, deliver } = makeClient();

    await deliver({ type: 'update', listId: 'list-1', payload: garbledEnvelope() });

    expect(applied).toEqual([]); // nothing was applied
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(DecryptFailureError);
    expect((errors[0] as DecryptFailureError).context).toBe('list-1');
  });

  it('reports an undecryptable sync_request too', async () => {
    const { client, errors, deliver } = makeClient();
    let answered = false;
    client.onSyncRequest = () => {
      answered = true;
    };

    await deliver({ type: 'sync_request', listId: 'list-2', payload: garbledEnvelope() });

    expect(answered).toBe(false);
    expect(errors[0]).toBeInstanceOf(DecryptFailureError);
  });

  it('does not throw out of handleMessage — one bad list must not kill the socket', async () => {
    const { deliver, applied } = makeClient();

    await expect(
      deliver({ type: 'update', listId: 'bad', payload: garbledEnvelope() }),
    ).resolves.not.toThrow();

    // A good message after a bad one is still processed.
    await deliver({ type: 'ack' });
    expect(applied).toEqual([]);
  });
});

describe('reporting is throttled, because the relay replays 30 days of updates', () => {
  it('reports a given list once, however many messages fail', async () => {
    const { errors, deliver } = makeClient();

    for (let i = 0; i < 50; i++) {
      await deliver({ type: 'update', listId: 'list-1', payload: garbledEnvelope() });
    }

    // Unthrottled this is 50 store writes and 50 console lines per reconnect,
    // which is its own outage.
    expect(errors).toHaveLength(1);
  });

  it('still reports a DIFFERENT list', async () => {
    const { errors, deliver } = makeClient();

    await deliver({ type: 'update', listId: 'list-1', payload: garbledEnvelope() });
    await deliver({ type: 'update', listId: 'list-1', payload: garbledEnvelope() });
    await deliver({ type: 'update', listId: 'list-2', payload: garbledEnvelope() });

    expect(errors).toHaveLength(2);
    expect(errors.map((e) => (e as DecryptFailureError).context)).toEqual(['list-1', 'list-2']);
  });
});

describe('what the user actually sees', () => {
  it('does NOT say "Synced" once a ciphertext has failed', () => {
    // THE TEST THAT MATTERS. A wrong-key device is connected and idle: every
    // signal the socket has says everything is fine. Asserting only that
    // `decryptFailures` incremented is the assertion that passed while the
    // indicator read "Synced".
    useSyncStore.getState().setConnectionState('connected');
    expect(useSyncStore.getState().syncState).toBe('idle');
    expect(rendered().label).toBe('Synced');

    useSyncStore.getState().noteDecryptFailure('list-1');

    expect(rendered().label).not.toBe('Synced');
    expect(rendered().label).toMatch(/can't read/i);
    expect(rendered().color).toBe('#f44336');
  });

  it('survives a reconnect — a key mismatch is not cured by reconnecting', () => {
    useSyncStore.getState().noteDecryptFailure('list-1');
    expect(rendered().label).not.toBe('Synced');

    // The exact sequence that used to erase it: syncState is recomputed from
    // the socket on every transition, and a wrong-key device connects fine.
    useSyncStore.getState().setConnectionState('disconnected');
    useSyncStore.getState().setConnectionState('connecting');
    useSyncStore.getState().setConnectionState('connected');

    expect(useSyncStore.getState().syncState).toBe('idle');
    expect(rendered().label).not.toBe('Synced');
  });

  it('hides the "last synced" timestamp, which reads as reassurance', () => {
    useSyncStore.getState().markSynced();
    expect(useSyncStore.getState().lastSyncedAt).not.toBeNull();

    useSyncStore.getState().noteDecryptFailure('list-1');
    expect(rendered().label).not.toBe('Synced');
  });

  it('routes a DecryptFailureError to the sticky channel, others to syncState', () => {
    // The WIRING, not just the pieces. bootstrap's onSyncError is one line
    // delegating here, so this is the decision that actually runs. A previous
    // version of that callback set `error` alone and the indicator never
    // showed it.
    useSyncStore.getState().reportSyncError(new DecryptFailureError('list-9'));
    expect(useSyncStore.getState().decryptFailures).toBe(1);
    expect(useSyncStore.getState().lastDecryptContext).toBe('list-9');
    expect(useSyncStore.getState().syncState).not.toBe('error'); // not the generic channel
    expect(rendered().label).toMatch(/can't read/i);

    useSyncStore.setState({ decryptFailures: 0, lastDecryptContext: null });
    useSyncStore.getState().reportSyncError(new Error('relay unreachable'));
    expect(useSyncStore.getState().decryptFailures).toBe(0);
    expect(useSyncStore.getState().syncState).toBe('error');
    expect(rendered().label).toBe('relay unreachable');
  });

  it('bootstrap delegates to reportSyncError rather than writing the store itself', () => {
    // Static check, the idiom this suite already uses for wiring it cannot
    // execute. The failure being guarded is a callback that writes `error`
    // directly and bypasses the routing above.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src/sync/bootstrap.ts'),
      'utf8',
    );
    expect(src).toMatch(/onSyncError:[^}]*reportSyncError\(err\)/);
    expect(src).not.toMatch(/onSyncError:[^}]*setState\(\{\s*error:/);
  });

  it('renders an ordinary sync error, which used to be invisible', () => {
    // bootstrap wrote `error` without `syncState`, and the label only consults
    // `error` in the error state — so the message went nowhere.
    expect(syncIndicatorStatus({ syncState: 'idle', error: 'boom', decryptFailures: 0 }).label).toBe(
      'Synced',
    );
    expect(
      syncIndicatorStatus({ syncState: 'error', error: 'boom', decryptFailures: 0 }).label,
    ).toBe('boom');
  });

  it('leaves every non-failing state alone', () => {
    const cases: Array<[Parameters<typeof syncIndicatorStatus>[0], string]> = [
      [{ syncState: 'idle', error: null, decryptFailures: 0 }, 'Synced'],
      [{ syncState: 'syncing', error: null, decryptFailures: 0 }, 'Syncing...'],
      [{ syncState: 'offline', error: null, decryptFailures: 0 }, 'Offline'],
      [{ syncState: 'not_configured', error: null, decryptFailures: 0 }, 'Local only'],
    ];
    for (const [state, label] of cases) {
      expect(syncIndicatorStatus(state).label).toBe(label);
    }
  });
});

describe('hydrate withholds the field AND says so', () => {
  it('returns null and records the failure', async () => {
    const envelope = await encrypt('secret value', KEY_A, 'item.name');
    // Same envelope, different key — the post-wrong-recovery state.
    const out = await decryptField(JSON.stringify(envelope), KEY_B, 'item.name');

    expect(out).toBeNull(); // still fails closed
    expect(useSyncStore.getState().decryptFailures).toBe(1);
    expect(rendered().label).not.toBe('Synced');
  });

  it('still returns plaintext and legacy rows untouched', async () => {
    expect(await decryptField('a legacy plaintext row', KEY_A, 'item.name')).toBe(
      'a legacy plaintext row',
    );
    expect(await decryptField('{"not":"an envelope"}', KEY_A, 'item.name')).toBe(
      '{"not":"an envelope"}',
    );
    // No false alarm from either.
    expect(useSyncStore.getState().decryptFailures).toBe(0);
  });

  it('round-trips correctly with the right key, reporting nothing', async () => {
    const envelope = await encrypt('secret value', KEY_A, 'item.name');
    expect(await decryptField(JSON.stringify(envelope), KEY_A, 'item.name')).toBe('secret value');
    expect(useSyncStore.getState().decryptFailures).toBe(0);
  });

  it('reports each context once — hydration walks every row', async () => {
    const envelope = JSON.stringify(await encrypt('v', KEY_A, 'item.name'));

    for (let i = 0; i < 20; i++) await decryptField(envelope, KEY_B, 'item.name');
    expect(useSyncStore.getState().decryptFailures).toBe(1);

    const other = JSON.stringify(await encrypt('v', KEY_A, 'list.description'));
    await decryptField(other, KEY_B, 'list.description');
    expect(useSyncStore.getState().decryptFailures).toBe(2);
  });
});

/** The label the indicator would render for the current store state. */
function rendered() {
  const s = useSyncStore.getState();
  return syncIndicatorStatus({
    syncState: s.syncState,
    error: s.error,
    decryptFailures: s.decryptFailures,
  });
}
