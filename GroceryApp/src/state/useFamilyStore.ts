/**
 * Zustand store: Family Members.
 *
 * Uses Yjs as the source of truth for real-time sync. WatermelonDB persistence
 * is handled by SyncManager observing Yjs changes.
 *
 * All mutations go through Yjs shared types which handle CRDT merging
 * across family members automatically.
 */

import { create } from 'zustand';
import type { FamilyMember, SyncStatus } from '../types';
import { generateUUID } from '../crypto';
import * as Y from 'yjs';
import {
  getDoc,
  extractFamilyMembers,
} from '../sync/yjs-adapter';

// ─── State Shape ────────────────────────────────────────────────────────────

export interface FamilyState {
  members: Record<string, FamilyMember>;
  activeMemberId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadMembers: (familyId: string) => Promise<void>;
  addMember: (member: Omit<FamilyMember, 'id' | 'joinedAt' | 'updatedAt' | 'version' | 'syncStatus'>) => Promise<FamilyMember>;
  updateMember: (id: string, changes: Partial<FamilyMember>) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  setActiveMember: (id: string | null) => void;
  clearError: () => void;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useFamilyStore = create<FamilyState>((set, get) => ({
  members: {},
  activeMemberId: null,
  isLoading: false,
  error: null,

  loadMembers: async (familyId: string) => {
    set({ isLoading: true, error: null });
    try {
      // Extract from Yjs (hydrated from WatermelonDB on app start)
      const yjsMembers = extractFamilyMembers();
      const filtered = yjsMembers.filter((m) => m.familyId === familyId);
      const membersMap: Record<string, FamilyMember> = {};
      for (const member of filtered) {
        membersMap[member.id] = member;
      }
      set({ members: membersMap, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load members',
      });
    }
  },

  addMember: async (memberData) => {
    const now = Date.now();
    const id = await generateUUID();
    const newMember: FamilyMember = {
      ...memberData,
      id,
      isDeleted: false,
      deletedAt: null,
      version: 1,
      syncStatus: 'created',
      joinedAt: now,
      updatedAt: now,
    };

    // Add to Yjs family document
    const doc = getDoc('__family__');
    doc.transact(() => {
      const membersMap = doc.getMap('members');
      const yMember = new Y.Map();
      Object.entries(newMember).forEach(([key, value]) => {
        yMember.set(key, value as any);
      });
      membersMap.set(newMember.id, yMember);
    });

    set((state) => ({
      members: { ...state.members, [newMember.id]: newMember },
    }));

    return newMember;
  },

  updateMember: async (id, changes) => {
    const existing = get().members[id];
    if (!existing) return;

    // Protect joinedAt from being overwritten
    const { joinedAt: _, ...safeChanges } = changes;

    // Update via Yjs
    const doc = getDoc('__family__');
    doc.transact(() => {
      const membersMap = doc.getMap('members');
      const yMember = membersMap.get(id) as any;
      if (yMember) {
        Object.entries(safeChanges).forEach(([key, value]) => {
          yMember.set(key, value as any);
        });
        yMember.set('version', existing.version + 1);
        yMember.set('syncStatus', 'updated');
        yMember.set('updatedAt', Date.now());
      }
    });

    set((state) => ({
      members: {
        ...state.members,
        [id]: {
          ...existing,
          ...safeChanges,
          version: existing.version + 1,
          syncStatus: 'updated' as SyncStatus,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  removeMember: async (id) => {
    const existing = get().members[id];
    if (!existing) return;

    // Soft-delete via Yjs
    const doc = getDoc('__family__');
    doc.transact(() => {
      const membersMap = doc.getMap('members');
      const yMember = membersMap.get(id) as any;
      if (yMember) {
        yMember.set('isActive', false);
        yMember.set('isDeleted', true);
        yMember.set('deletedAt', Date.now());
        yMember.set('syncStatus', 'deleted');
        yMember.set('version', existing.version + 1);
        yMember.set('updatedAt', Date.now());
      }
    });

    set((state) => ({
      members: {
        ...state.members,
        [id]: {
          ...existing,
          isActive: false,
          isDeleted: true,
          deletedAt: Date.now(),
          syncStatus: 'deleted' as SyncStatus,
          version: existing.version + 1,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  setActiveMember: (id) => {
    set({ activeMemberId: id });
  },

  clearError: () => {
    set({ error: null });
  },
}));