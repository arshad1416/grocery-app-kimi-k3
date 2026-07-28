/**
 * Sync — barrel exports.
 */

export { YjsWebSocketClient } from './y-websocket';
export type { WebSocketConfig, ConnectionState, OfflineEntry } from './y-websocket';
export {
  getDoc,
  getListMeta,
  getItemsArray,
  getAwarenessMap,
  hydrateList,
  hydrateFamilyMembers,
  extractList,
  extractItems,
  extractFamilyMembers,
  yjsAddItem,
  yjsUpdateItem,
  yjsDeleteItem,
  yjsUpdateListMeta,
  yjsClaimItem,
  yjsUnclaimItem,
  CLAIM_EXPIRY_MS,
  setAwareness,
  getAwareness,
  destroyDoc,
  getActiveDocIds,
} from './yjs-adapter';
export { SyncManager, syncManager } from './sync-manager';
export type { SyncCallbacks } from './sync-manager';