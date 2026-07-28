# PantryRun Architecture: Delete Grocery List

**Feature:** Swipe-to-Delete + Long-Press Context Menu for List Deletion  
**Tag:** `v1.03+`  
**Date:** 2026-06-15  

---

## 1. Overview

Currently, the HomeScreen displays list cards with only a "Share" button and a tap-to-navigate action. There is **no way to delete a grocery list**. This feature adds two deletion gestures and a confirmation dialog, with full sync propagation to paired family members.

---

## 2. User Experience

### 2.1 Swipe-to-Delete (iOS Mail style)

```
┌─────────────────────────────────────────────┐
│ My Grocery List            Share  ›         │
│ Weekly groceries                             │
│ 🏪 Costco                                 │
├─────────────────────────────────────────────┤
│               ╔══════════╗                   │
│               ║  DELETE  ║  ← red, revealed  │
│               ╚══════════╝   on left swipe   │
└─────────────────────────────────────────────┘
```

- Swiping left on a list card reveals a red "Delete" action panel.
- Releasing on the delete action triggers the **confirmation dialog**.
- Swiping back right cancels.

### 2.2 Long-Press Context Menu

- Long-pressing (≥500ms) on a list card shows a native context menu:
  - **Delete List** (destructive, red)
  - **Share** (existing action, moved here as secondary option)
- Selecting "Delete List" triggers the **confirmation dialog**.

### 2.3 Confirmation Dialog

```
┌──────────────────────────────────┐
│  Delete "My Grocery List"?       │
│                                  │
│  This will remove the list for   │
│  all family members.             │
│                                  │
│  [Cancel]          [Delete]      │
└──────────────────────────────────┘
```

- Shows the list name in the title.
- Cancel dismisses; Delete proceeds.
- The Delete button is red/destructive styled.

---

## 3. Architecture

### 3.1 Component Hierarchy

```
HomeScreen
├── SwipeableListCard (NEW — wraps each list card)
│   ├── PanGestureHandler (react-native-gesture-handler)
│   │   └── Animated list card content
│   └── Swipe-to-delete reveal panel (red background)
├── ContextMenu (NEW — long-press overlay)
│   └── "Delete List" / "Share" options
└── DeleteConfirmationModal (NEW)
```

### 3.2 Data Flow

```
User gesture (swipe/long-press)
  │
  ▼
DeleteConfirmationModal
  │  "Are you sure?"
  ▼
useListStore.deleteList(listId)
  │
  ├── 1. yjsUpdateListMeta(listId, { isDeleted: true, ... })
  │      └── Yjs CRDT merge → syncs via WebSocket to relay
  │
  ├── 2. Send family notification
  │      └── sendFamilyNotification('list_deleted', ...)
  │           └── Encrypted payload → WebSocket relay → all peers
  │
  ├── 3. syncManager.unregisterList(listId)
  │      └── Stop observing Yjs doc, destroy doc
  │
  └── 4. Remove from lists index
         └── indexDoc.getMap('listIds').delete(listId)
```

### 3.3 Data Layer — What Already Exists

| Layer | Component | Already Supports Delete? |
|-------|-----------|--------------------------|
| **Types** | `GroceryList.isDeleted`, `deletedAt`, `syncStatus: 'deleted'` | ✅ Yes |
| **Zustand** | `useListStore.deleteList(id)` | ✅ Yes — soft-deletes via Yjs |
| **Yjs Adapter** | `yjsUpdateListMeta()` | ✅ Yes — sets `isDeleted`, `deletedAt` |
| **WatermelonDB** | `GroceryListModel` has `isDeleted`, `deletedAt` fields | ✅ Yes |
| **Sync Manager** | `unregisterList()`, `destroyDoc()` | ✅ Yes |
| **HomeScreen filter** | `activeLists = Object.values(lists).filter(l => !l.isDeleted)` | ✅ Yes |
| **Notification Manager** | `sendFamilyNotification()` | ✅ Yes for items |
| **WebSocket Relay** | Handles `notification` messages | ✅ Yes |

**Conclusion:** The data layer is fully wired. The gap is purely in the **UI** (no gesture or context menu) and the **notification event type** (needs `list_deleted`).

---

## 4. Detailed Implementation Plan

### 4.1 New File: `src/components/SwipeableListCard.tsx`

A wrapper component using `react-native-gesture-handler`'s `PanGestureHandler` + `Animated` API.

```tsx
interface SwipeableListCardProps {
  list: GroceryList;
  onPress: () => void;
  onDelete: () => void;
  onShare: () => void;
  theme: ThemeColors;
}
```

**Key implementation details:**
- Use `PanGestureHandler` from `react-native-gesture-handler` (already a dependency via React Navigation).
- Animate the card content horizontally with `Animated.Value`.
- Red delete panel behind the card (absolute positioned).
- Threshold: swipe left ≥ 80px triggers delete action.
- `onGestureEvent` → translate card left.
- `onHandlerStateChange` → if released past threshold, call `onDelete()`; otherwise, spring back.
- Use `react-native-reanimated` if available for smoother 60fps animations; otherwise, `Animated` from RN core.

**Gesture conflict resolution:**
- The `ScrollView` in HomeScreen must use `SimultaneousHandlers` to allow both scroll and swipe.
- `waitFor` the `PanGestureHandler` on the X-axis only (ignore vertical swipes).
- Native gesture handler: `activeOffsetX={[-20, 20]}` to only activate on horizontal swipe.

### 4.2 New File: `src/components/ContextMenu.tsx`

Long-press context menu overlay.

```tsx
interface ContextMenuProps {
  visible: boolean;
  listName: string;
  onDelete: () => void;
  onShare: () => void;
  onClose: () => void;
  theme: ThemeColors;
}
```

**Options:**
- Uses React Native's `Modal` with transparent background.
- Positioned near the long-pressed card (tracks touch coordinates via `onLongPress` event).
- Menu items: "Delete List" (red) and "Share" (normal).
- Tap outside dismisses.

**Alternative: Native context menu**  
On iOS 13+, use `ContextMenu` from `react-native-ios-context-menu` for a native feel. For cross-platform, the custom `Modal` approach is simpler.

### 4.3 New File: `src/components/DeleteConfirmationModal.tsx`

```tsx
interface DeleteConfirmationModalProps {
  visible: boolean;
  listName: string;
  onCancel: () => void;
  onConfirm: () => void;
  theme: ThemeColors;
}
```

- Simple `Modal` with `Alert.alert`-style layout.
- Title: `Delete "${listName}"?`
- Body: "This will remove the list for all family members."
- Cancel (neutral) / Delete (red) buttons.

### 4.4 Modify: `src/state/useListStore.ts`

The existing `deleteList` method is nearly complete. Enhancements needed:

```ts
deleteList: async (id) => {
  const existing = get().lists[id];
  if (!existing) return;

  // 1. Soft-delete via Yjs (already exists)
  yjsUpdateListMeta(id, {
    isDeleted: true,
    deletedAt: Date.now(),
    isActive: false,
    syncStatus: 'deleted',
  });

  // 2. Remove from lists index (NEW)
  const indexDoc = getDoc('__lists_index__');
  indexDoc.transact(() => {
    const indexMap = indexDoc.getMap('listIds');
    indexMap.delete(id);
  });

  // 3. Unregister from sync (NEW)
  syncManager.unregisterList(id);

  // 4. Send family notification (NEW)
  const encryptionKey = syncManager.getEncryptionKey();
  if (encryptionKey) {
    await sendFamilyNotification(
      'list_deleted',  // new event type
      id,
      existing.name,
      id,               // listId as "itemId" for list-level events
      existing.name,    // list name as "itemName"
      'list',           // category
      encryptionKey,
    );
  }

  // 5. Update local state
  set((state) => {
    const { [id]: _, ...remaining } = state.lists;
    return { lists: remaining };
  });
},
```

### 4.5 Modify: `src/types/notifications.ts`

Add `list_deleted` event type:

```ts
export type NotificationEventType =
  | 'item_added'
  | 'item_checked'
  | 'item_unchecked'
  | 'item_deleted'
  | 'list_deleted'    // NEW
  | 'list_shared';    // NEW — optional, for future
```

### 4.6 Modify: `src/notifications/NotificationManager.ts`

Add display text for the new event type in `buildNotificationText`:

```ts
case 'list_deleted':
  return {
    title: 'List Deleted',
    body: `"${truncatedList}" was deleted`,
  };
```

### 4.7 Modify: `src/screens/HomeScreen.tsx`

Replace the existing `TouchableOpacity` list card with `SwipeableListCard`:

```tsx
{activeLists.map((list) => (
  <SwipeableListCard
    key={list.id}
    list={list}
    onPress={() => handleListPress(list)}
    onDelete={() => setPendingDelete(list)}
    onShare={() => shareInvite(/* existing share logic */)}
    theme={theme}
  />
))}
```

Add state for the confirmation modal:

```tsx
const [pendingDelete, setPendingDelete] = useState<GroceryList | null>(null);

// In JSX:
<DeleteConfirmationModal
  visible={!!pendingDelete}
  listName={pendingDelete?.name ?? ''}
  onCancel={() => setPendingDelete(null)}
  onConfirm={async () => {
    if (pendingDelete) {
      await deleteList(pendingDelete.id);
      setPendingDelete(null);
    }
  }}
  theme={theme}
/>
```

### 4.8 Modify: `src/storage/hydrate.ts`

Add a helper to purge hard-deleted lists after a grace period (e.g., 30 days):

```ts
export async function purgeExpiredDeletedLists(
  key: Uint8Array,
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000,
): Promise<string[]> {
  const lists = await loadListsFromDB(key);
  const now = Date.now();
  const purged: string[] = [];

  for (const list of lists) {
    if (list.isDeleted && list.deletedAt && now - list.deletedAt > maxAgeMs) {
      await deleteRecord('grocery_lists', list.id);
      // Also delete all items belonging to this list
      const items = await loadItemsFromDB(key);
      for (const item of items.filter(i => i.listId === list.id)) {
        await deleteRecord('grocery_items', item.id);
      }
      purged.push(list.id);
    }
  }

  return purged;
}
```

---

## 5. Undo Support

For a polished experience, implement an **undo toast** (the existing `UndoToast.tsx` component):

```
┌─────────────────────────────────────────────┐
│ "My Grocery List" deleted        [UNDO]     │
└─────────────────────────────────────────────┘
```

**Undo mechanism:**
- When delete is confirmed, store the deleted list data in a temporary ref.
- Show `UndoToast` with a 5-second timer.
- On "Undo": restore the list by re-setting `isDeleted: false` via Yjs, re-registering for sync, and re-adding to the lists index.
- On timeout: the deletion is permanent (synced to all peers).

```ts
// In HomeScreen
const [undoList, setUndoList] = useState<GroceryList | null>(null);

const handleDeleteConfirm = async () => {
  if (!pendingDelete) return;
  setUndoList(pendingDelete);
  await deleteList(pendingDelete.id);
  setPendingDelete(null);
  // UndoToast auto-dismisses after 5s
};

const handleUndo = async () => {
  if (!undoList) return;
  await restoreList(undoList);
  setUndoList(null);
};
```

---

## 6. Dependency Check

| Dependency | Status | Notes |
|-----------|--------|-------|
| `react-native-gesture-handler` | ✅ Installed | Via React Navigation (peer dep) |
| `react-native-reanimated` | ❓ Check | Needed for smooth swipe animations. Can use RN `Animated` as fallback. |
| `react-native-ios-context-menu` | ❌ Not installed | Optional — only if using native iOS context menu |

**Recommendation:** Use `react-native-gesture-handler` `PanGestureHandler` + RN `Animated` API. This avoids adding new dependencies and works cross-platform. If performance is an issue, add `react-native-reanimated` later.

---

## 7. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/SwipeableListCard.tsx` | **CREATE** | Swipe-to-delete wrapper component |
| `src/components/ContextMenu.tsx` | **CREATE** | Long-press context menu |
| `src/components/DeleteConfirmationModal.tsx` | **CREATE** | Confirmation dialog |
| `src/screens/HomeScreen.tsx` | **MODIFY** | Integrate new components, add delete state |
| `src/state/useListStore.ts` | **MODIFY** | Enhance `deleteList` with index cleanup + notifications |
| `src/types/notifications.ts` | **MODIFY** | Add `list_deleted` event type |
| `src/notifications/NotificationManager.ts` | **MODIFY** | Add display text for `list_deleted` |
| `src/components/UndoToast.tsx` | **MODIFY** | Wire up undo callback (may already support) |

---

## 8. Edge Cases & Considerations

1. **Race condition:** If family member A deletes a list while member B is editing items in it → CRDT handles this gracefully. The list becomes `isDeleted: true` and member B's next navigation will see the filtered view.

2. **Offline deletion:** If the device is offline when deleting, the Yjs update is queued locally. When connectivity resumes, the update syncs. Other family members see the deletion when they next sync.

3. **Last list:** If the user deletes their only list, the empty state UI is shown (already implemented: `activeLists.length === 0`).

4. **Shared list:** When one family member deletes a shared list, ALL members lose access. This is intentional — the confirmation dialog warns "This will remove the list for all family members."

5. **Recovery:** A 30-day grace period allows recovery via the undo mechanism or a future "Recently Deleted" screen. After 30 days, WatermelonDB records are hard-deleted.

6. **Notification payload:** For `list_deleted`, the `itemId` field is repurposed as the `listId` (the deleted list's ID). The `itemName` field contains the list name. This avoids changing the `NotificationPayload` interface.
