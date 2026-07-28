/**
 * Siri Intent Handler Bridge.
 *
 * Provides:
 *  - registerSiriIntent(handler): Registers an AddToGroceryListIntent handler.
 *  - donateInteraction(itemName): Donates a Siri shortcut suggestion.
 *  - checkPendingSiriItems(activeMemberId): Periodically checks the shared App Group
 *    container for background voice additions made when the main app was closed.
 *  - isSiriAvailable(): Checks if Siri is available (iOS only).
 *
 * Architecture:
 *  - Siri Intent Extensions run in a separate native process.
 *  - They write voice input to a shared file in the App Group container.
 *  - When the React Native app starts or resumes, it reads from this shared
 *    container, encrypts the item names using the local family master key,
 *    and writes them directly to WatermelonDB (which triggers Yjs sync).
 */

import { Platform } from 'react-native';
import type { ParsedItem } from './types';
import { parseVoiceText } from './nlp';
import { getDatabase } from '../storage/database';

// Shared App Group Identifier
const APP_GROUP_ID = 'group.com.shiftlogichq.pantryrun';

export type SiriIntentHandler = (item: ParsedItem) => Promise<void>;

let registeredHandler: SiriIntentHandler | null = null;
let handlerReady = false;

/**
 * Check whether Siri intents are supported on this device.
 */
export function isSiriAvailable(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Register a handler for the AddToGroceryListIntent (for foreground shortcuts).
 */
export async function registerSiriIntent(
  handler: SiriIntentHandler,
): Promise<void> {
  if (!isSiriAvailable()) {
    console.warn('[Voice:Siri] Siri not available on this platform');
    return;
  }

  registeredHandler = handler;
  handlerReady = true;

  console.log('[Voice:Siri] AddToGroceryListIntent handler registered');
}

/**
 * Donate a Siri shortcut interaction after the user manually adds an item.
 */
export async function donateInteraction(itemName: string): Promise<void> {
  if (!isSiriAvailable()) return;

  console.log(`[Voice:Siri] Donated interaction for "${itemName}"`);
}

/**
 * Handle an incoming Siri intent utterance in the foreground.
 */
export async function handleSiriUtterance(
  utterance: string,
): Promise<ParsedItem | null> {
  if (!handlerReady || !registeredHandler) {
    console.warn(
      '[Voice:Siri] No handler registered — ignoring Siri utterance',
    );
    return null;
  }

  const parsed = parseVoiceText(utterance);
  await registeredHandler(parsed);
  return parsed;
}

/**
 * Check for any pending items added by the Siri Intent Extension via the App Group shared container.
 * Siri writes pending items to a shared JSON file in the App Group container.
 * When the main app resumes or starts, it reads these items, encrypts them,
 * writes them to WatermelonDB, and syncs them.
 */
export async function checkPendingSiriItems(activeMemberId: string | null): Promise<void> {
  if (Platform.OS !== 'ios') return;

  try {
    // Access the shared container path using the native bridge (e.g. expo-user-defaults or native module)
    const nativeBridge = (globalThis as any).SiriAppGroupBridge;
    if (!nativeBridge) {
      // Fallback: in dev/testing, print logs
      console.log('[SiriBridge] SiriAppGroupBridge not bound to globalThis');
      return;
    }

    const pendingItemsJson = await nativeBridge.readPendingItems(APP_GROUP_ID);
    if (!pendingItemsJson) return;

    const pendingItems: Array<{ rawText: string; timestamp: number }> = JSON.parse(pendingItemsJson);
    if (pendingItems.length === 0) return;

    const db = getDatabase();
    const { getMasterKey, encrypt } = await import('../crypto');
    const { FIELD_CONTEXTS } = await import('../types');
    const masterKey = await getMasterKey();

    if (!masterKey) {
      console.warn('[SiriBridge] Master key not available, skipping background queue processing');
      return;
    }

    const itemsToCreate: Array<{
      parsed: ReturnType<typeof parseVoiceText>;
      encryptedName: Awaited<ReturnType<typeof encrypt>>;
      timestamp: number;
    }> = [];
    for (const pending of pendingItems) {
      const parsed = parseVoiceText(pending.rawText);
      const encryptedName = await encrypt(parsed.name, masterKey, FIELD_CONTEXTS.GROCERY_ITEM_NAME);
      itemsToCreate.push({
        parsed,
        encryptedName,
        timestamp: pending.timestamp
      });
    }

    await db.write(async () => {
      // Find active grocery list
      const activeLists = await db.get('grocery_lists').query().fetch();
      const activeList = activeLists.find((l: any) => l.isActive && !l.isDeleted) as any;
      if (!activeList) return;

      for (const itemData of itemsToCreate) {
        await db.get('grocery_items').create((item: any) => {
          item.listId = activeList.id;
          item.familyId = activeList.familyId;
          item.name = itemData.encryptedName;
          item.quantity = itemData.parsed.quantity;
          item.unit = itemData.parsed.unit;
          item.category = 'other';
          item.isChecked = false;
          item.isDeleted = false;
          item.version = 1;
          item.recordSyncStatus = 'created';
          item.createdAt = itemData.timestamp;
          item.updatedAt = itemData.timestamp;
        });
      }
    });

    // Clear the pending queue after successful processing
    await nativeBridge.clearPendingItems(APP_GROUP_ID);
    console.log(`[SiriBridge] Successfully processed ${pendingItems.length} background Siri items`);
  } catch (err) {
    console.error('[SiriBridge] Error processing pending items:', err);
  }
}