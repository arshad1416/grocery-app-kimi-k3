/**
 * PantryRun Plus — entitlement resolution, purchase, and restore.
 *
 * ── INVARIANT (Goal 7) ───────────────────────────────────────────────────────
 * This is the ONLY file that may compute entitlement state. No other file may
 * read a receipt, read purchase state, touch the `entitlements` table, or
 * default a gating flag. Every other file imports `useEntitlementStore` /
 * `isPlusEntitled()` from here. Scattered checks are how a paywall grows a
 * path that forgot to check — in a public repo that is the difference between
 * honest-user gating and no gating at all.
 *
 * ── Model (owner decision, 2026-07-28, GOAL_PROMPT_NOTES.md) ────────────────
 * One purchase unlocks the family: the purchasing device writes an
 * entitlement record into the family Yjs document (top-level `entitlements`
 * map, E2E-encrypted in transit like everything else in the doc) so it syncs
 * to every family device, AND into the local `entitlements` table so it
 * survives app restart — Yjs document state itself is never persisted.
 *
 * Receipt validation happens at purchase time on-device (a store purchase /
 * restore must present a receipt or purchase token before we grant).
 * Server-side validation via Apple's App Store Server API / Google's Play
 * Developer API needs owner-held credentials and is deliberately absent: the
 * repository is public, client-side gating is bypassable by building from
 * source, and honest-user monetization is the accepted stance. Do not add
 * DRM here — it costs engineering time and buys nothing against the only
 * attacker who could defeat it anyway.
 *
 * react-native-iap is imported lazily inside the purchase/restore paths so
 * that importing this module never touches native billing code (keeps Jest
 * and app boot free of the native module).
 */

import { create } from 'zustand';
import { Q } from '@nozbe/watermelondb';
import { getDatabase } from '../storage/database';
import { getDoc } from '../sync/yjs-adapter';

// ─── Product constants ───────────────────────────────────────────────────────
// Same SKU on both stores. Products are created by the owner in App Store
// Connect / Play Console (see audit-package/08 handoff); price is display-only
// here — the stores are the source of truth for what is charged.

export const PLUS_PRODUCT_ID = 'pantryrun_plus_annual';
export const PLUS_PRICE_DISPLAY = '$14.99/year';

/**
 * Paywall copy. States precisely what the savings figure compares against:
 * trip-plan.ts computes savings as the best single-store trip minus the
 * optimized multi-stop total (one-stop baseline, floored at 0).
 */
export const PLUS_PAYWALL_COPY =
  'PantryRun Plus unlocks the Trip Optimizer: the cheapest way to split ' +
  'your list across nearby stores, with savings shown against doing the ' +
  'whole trip at the cheapest single store. One purchase unlocks your ' +
  `whole family. ${PLUS_PRICE_DISPLAY}.`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlusEntitlement {
  familyId: string;
  productId: string;
  platform: 'ios' | 'android' | 'unknown';
  transactionId: string;
  purchasedAt: number;
  /** null = non-expiring (store manages renewal; we re-check on restore). */
  expiresAt: number | null;
  source: 'purchase' | 'restore' | 'sync';
}

export interface EntitlementState {
  /** THE gating answer. Computed only inside this module. */
  isPlus: boolean;
  record: PlusEntitlement | null;
  resolution: 'unresolved' | 'resolved';
  busy: boolean;
  lastError: string | null;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useEntitlementStore = create<EntitlementState>(() => ({
  isPlus: false,
  record: null,
  resolution: 'unresolved',
  busy: false,
  lastError: null,
}));

/** Synchronous read for non-React callers. Resolve first via resolveEntitlement(). */
export function isPlusEntitled(): boolean {
  return useEntitlementStore.getState().isPlus;
}

// ─── Entitlement computation (the only place this logic exists) ──────────────

function computeIsPlus(record: PlusEntitlement | null): boolean {
  if (!record) return false;
  if (record.productId !== PLUS_PRODUCT_ID) return false;
  if (!record.transactionId) return false;
  if (record.expiresAt !== null && record.expiresAt < Date.now()) return false;
  return true;
}

// ─── Local table (restart survival) ─────────────────────────────────────────

async function loadLocalRecord(): Promise<PlusEntitlement | null> {
  const rows = await getDatabase()
    .get('entitlements')
    .query(Q.where('product_id', PLUS_PRODUCT_ID))
    .fetch();
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    familyId: r.familyId,
    productId: r.productId,
    platform: r.platform,
    transactionId: r.transactionId,
    purchasedAt: r.purchasedAt,
    expiresAt: r.expiresAt ?? null,
    source: r.source,
  };
}

/**
 * Upsert the local entitlement record. Single flat database.write — real
 * WatermelonDB deadlocks on nested write() even though the Jest mock permits
 * it, so no caller of this function may already hold a writer.
 */
async function persistLocalRecord(record: PlusEntitlement): Promise<void> {
  const collection = getDatabase().get('entitlements');
  const existing = await collection
    .query(Q.where('product_id', record.productId))
    .fetch();
  await getDatabase().write(async () => {
    if (existing.length > 0) {
      await existing[0].update((row: any) => {
        row.familyId = record.familyId;
        row.platform = record.platform;
        row.transactionId = record.transactionId;
        row.purchasedAt = record.purchasedAt;
        row.expiresAt = record.expiresAt;
        row.source = record.source;
        row.updatedAt = Date.now();
      });
    } else {
      await collection.create((row: any) => {
        row.familyId = record.familyId;
        row.productId = record.productId;
        row.platform = record.platform;
        row.transactionId = record.transactionId;
        row.purchasedAt = record.purchasedAt;
        row.expiresAt = record.expiresAt;
        row.source = record.source;
        row.updatedAt = Date.now();
      });
    }
  });
}

// ─── Family Yjs document (cross-device sync) ─────────────────────────────────

const FAMILY_DOC_ID = '__family__';

function writeRecordToFamilyDoc(record: PlusEntitlement): void {
  const doc = getDoc(FAMILY_DOC_ID);
  doc.transact(() => {
    doc.getMap('entitlements').set(PLUS_PRODUCT_ID, {
      familyId: record.familyId,
      productId: record.productId,
      platform: record.platform,
      transactionId: record.transactionId,
      purchasedAt: record.purchasedAt,
      expiresAt: record.expiresAt,
    });
  });
}

let familyDocObserverInstalled = false;

/**
 * Watch the family doc's entitlements map so a purchase made on another
 * family device (applied whole-document via Y.applyUpdate in sync-manager)
 * lands here: persisted locally with source 'sync', then resolved.
 */
function installFamilyDocObserver(): void {
  if (familyDocObserverInstalled) return;
  familyDocObserverInstalled = true;
  const map = getDoc(FAMILY_DOC_ID).getMap('entitlements');
  const apply = () => {
    const raw = map.get(PLUS_PRODUCT_ID) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return;
    const synced: PlusEntitlement = {
      familyId: String(raw.familyId ?? ''),
      productId: String(raw.productId ?? ''),
      platform: (raw.platform as PlusEntitlement['platform']) ?? 'unknown',
      transactionId: String(raw.transactionId ?? ''),
      purchasedAt: Number(raw.purchasedAt ?? 0),
      expiresAt: raw.expiresAt == null ? null : Number(raw.expiresAt),
      source: 'sync',
    };
    if (!computeIsPlus(synced)) return;
    const current = useEntitlementStore.getState().record;
    if (current && current.transactionId === synced.transactionId) return;
    persistLocalRecord(synced)
      .then(() => {
        useEntitlementStore.setState({ isPlus: true, record: synced, resolution: 'resolved' });
        console.log('[entitlements] resolved: entitled (synced from family document)');
      })
      .catch((err) => {
        // Still entitled in-memory this session; local persistence retries
        // on the next sync or resolve.
        useEntitlementStore.setState({ isPlus: true, record: synced, resolution: 'resolved' });
        console.warn('[entitlements] synced entitlement not persisted locally:', err);
      });
  };
  map.observe(apply);
  apply(); // a record may already be present from an earlier applied update
}

// ─── Resolution (app start / after purchase) ─────────────────────────────────

/**
 * Resolve entitlement from the local table, then keep listening on the
 * family document for grants made by other family devices.
 * Call once during app init, after the database is available.
 */
export async function resolveEntitlement(): Promise<boolean> {
  let record: PlusEntitlement | null = null;
  try {
    record = await loadLocalRecord();
  } catch (err) {
    console.warn('[entitlements] local record load failed:', err);
  }
  const isPlus = computeIsPlus(record);
  useEntitlementStore.setState({ isPlus, record, resolution: 'resolved' });
  console.log(
    `[entitlements] resolved: ${isPlus ? 'entitled' : 'not entitled'}` +
      ` (${record ? `local record, source=${record.source}` : 'no local record'})`,
  );
  installFamilyDocObserver();
  return isPlus;
}

// ─── Grant path (shared by purchase / restore / sync) ────────────────────────

async function grantEntitlement(record: PlusEntitlement): Promise<void> {
  await persistLocalRecord(record);
  writeRecordToFamilyDoc(record);
  // Make sure the family doc's update observer is sending, so the grant
  // reaches the rest of the family. Dynamic import: useSyncStore already
  // imports syncManager statically, a static back-import here would cycle.
  try {
    const { syncManager } = await import('../sync/sync-manager');
    syncManager.registerList(FAMILY_DOC_ID);
  } catch (err) {
    console.warn('[entitlements] family doc sync registration failed:', err);
  }
  useEntitlementStore.setState({ isPlus: computeIsPlus(record), record, resolution: 'resolved' });
  console.log(`[entitlements] granted via ${record.source} (tx ${record.transactionId})`);
}

async function currentFamilyId(): Promise<string> {
  try {
    const { getFamilyMembership } = await import('../identity/family');
    const membership = await getFamilyMembership();
    if (membership?.familyId) return membership.familyId;
  } catch {
    // fall through — solo devices can still hold an entitlement
  }
  return 'local';
}

// ─── Purchase / restore (react-native-iap v15, lazily loaded) ──────────────
// v15 is event-based: requestPurchase() dispatches the flow and the result
// arrives through purchaseUpdatedListener / purchaseErrorListener.

type IapPurchase = {
  productId?: string;
  transactionId?: string | null;
  /** Unified purchase token (iOS JWS, Android purchaseToken). */
  purchaseToken?: string | null;
  transactionDate?: number;
};

function receiptPresent(p: IapPurchase): boolean {
  // Purchase-time receipt check: a store purchase must carry a signed store
  // token (iOS JWS / Android purchase token) before we grant.
  return Boolean(p.purchaseToken || p.transactionId);
}

async function purchaseToRecord(
  p: IapPurchase,
  source: PlusEntitlement['source'],
): Promise<PlusEntitlement> {
  const { Platform } = await import('react-native');
  return {
    familyId: await currentFamilyId(),
    productId: p.productId ?? PLUS_PRODUCT_ID,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    transactionId: p.transactionId ?? p.purchaseToken ?? `tx-${Date.now()}`,
    purchasedAt: p.transactionDate ?? Date.now(),
    expiresAt: null, // stores own renewal; restore re-checks with the store
    source,
  };
}

/**
 * Buy PantryRun Plus on this device's store account, then unlock the family.
 * Returns true when the entitlement was granted.
 */
export async function purchasePlus(): Promise<boolean> {
  useEntitlementStore.setState({ busy: true, lastError: null });
  try {
    const iap = await import('react-native-iap');
    await iap.initConnection();

    const purchase = await new Promise<IapPurchase>((resolve, reject) => {
      const okSub = iap.purchaseUpdatedListener((p: any) => {
        okSub.remove();
        errSub.remove();
        resolve(p as IapPurchase);
      });
      const errSub = iap.purchaseErrorListener((e: any) => {
        okSub.remove();
        errSub.remove();
        reject(new Error(e?.message ?? e?.code ?? 'purchase failed'));
      });
      iap
        .requestPurchase({
          request: {
            apple: { sku: PLUS_PRODUCT_ID },
            google: {
              skus: [PLUS_PRODUCT_ID],
              // Single base plan (owner creates exactly one); Play resolves
              // the offer in its own UI when the token is not pre-fetched.
              subscriptionOffers: [{ sku: PLUS_PRODUCT_ID, offerToken: '' }],
            },
          },
          type: 'subs',
        })
        .catch((e: unknown) => {
          okSub.remove();
          errSub.remove();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });

    if (!receiptPresent(purchase)) {
      throw new Error('Purchase did not return a store receipt — not granting.');
    }
    await iap.finishTransaction({ purchase: purchase as any, isConsumable: false });
    await grantEntitlement(await purchaseToRecord(purchase, 'purchase'));
    return true;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    // User cancellation is not an error state worth surfacing loudly.
    const cancelled = /cancel/i.test(message);
    useEntitlementStore.setState({ lastError: cancelled ? null : message });
    if (!cancelled) console.warn('[entitlements] purchase failed:', message);
    return false;
  } finally {
    useEntitlementStore.setState({ busy: false });
  }
}

/**
 * Restore a previous purchase from this device's store account
 * (fresh install / new device on the same Apple ID or Google account).
 */
export async function restorePlus(): Promise<boolean> {
  useEntitlementStore.setState({ busy: true, lastError: null });
  try {
    const iap = await import('react-native-iap');
    await iap.initConnection();
    const purchases = (await iap.getAvailablePurchases()) as unknown as IapPurchase[];
    const match = purchases.find(
      (p) => p.productId === PLUS_PRODUCT_ID && receiptPresent(p),
    );
    if (!match) {
      useEntitlementStore.setState({ lastError: 'No previous purchase found on this store account.' });
      return false;
    }
    await grantEntitlement(await purchaseToRecord(match, 'restore'));
    return true;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    useEntitlementStore.setState({ lastError: message });
    console.warn('[entitlements] restore failed:', message);
    return false;
  } finally {
    useEntitlementStore.setState({ busy: false });
  }
}
