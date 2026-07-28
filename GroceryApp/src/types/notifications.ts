/**
 * Notification types for the family notification system.
 *
 * These types define the notification payload (encrypted end-to-end before
 * transmission) and the local storage record (persisted in WatermelonDB).
 */

/** Notification event types the system can emit */
export type NotificationEventType =
  | 'item_added'
  | 'item_checked'
  | 'item_unchecked'
  | 'item_deleted'
  | 'list_deleted'
  | 'voice_item_added'
  | 'voice_item_checked';

/** Voice assistant command source */
export type VoiceAssistantSource = 'alexa' | 'google' | 'home_assistant' | 'siri' | 'unknown';

/** Voice assistant action type */
export type VoiceAction = 'add' | 'read' | 'check';

/** Voice item payload — sent from voice assistant via relay WebSocket */
export interface VoiceItemPayload {
  /** The action to perform */
  action: VoiceAction;
  /** Generated item ID (for add actions) */
  itemId?: string;
  /** Target list ID */
  listId: string;
  /** Target list name (optional, null = primary list) */
  listName: string | null;
  /** Item details (for add actions) */
  item?: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    isChecked: boolean;
    category: string;
  };
  /** Item name to check off (for check actions) */
  itemName?: string;
  /** Source voice assistant */
  source: VoiceAssistantSource;
  /** Timestamp of the voice command (ms since epoch) */
  timestamp: number;
}

/** The notification payload — encrypted end-to-end before sending over the wire */
export interface NotificationPayload {
  /** Unique notification ID (UUID) */
  id: string;
  /** Event type */
  eventType: NotificationEventType;
  /** Timestamp (ms since epoch) */
  timestamp: number;
  /** Device ID of the sender (who performed the action) */
  senderDeviceId: string;
  /** List ID the item belongs to */
  listId: string;
  /** List name (encrypted — decrypted on receipt for display) */
  listName: string;
  /** Item ID */
  itemId: string;
  /** Item name (encrypted — decrypted on receipt for display) */
  itemName: string;
  /** Item category (for grouping/display) */
  itemCategory: string;
}

/** A stored notification record (persisted locally for badge count + history) */
export interface NotificationRecord {
  id: string;
  eventType: NotificationEventType;
  timestamp: number;
  senderDeviceId: string;
  listId: string;
  listName: string;
  itemId: string;
  itemName: string;
  itemCategory: string;
  /** Whether the user has seen/dismissed this notification */
  isRead: boolean;
}
