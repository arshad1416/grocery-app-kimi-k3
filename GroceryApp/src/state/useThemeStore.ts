/**
 * Zustand store: Theme Management.
 *
 * Persists the user's theme selection (system, light, dark) inside AppSettings
 * and exports a reactive useActiveTheme hook for styles.
 */

import { create } from 'zustand';
import { Appearance, useColorScheme } from 'react-native';
import { getSettings, updateSettings } from '../config/settings';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeState {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  hydrateTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeMode: 'system',

  setThemeMode: async (mode: ThemeMode) => {
    try {
      await updateSettings({ theme: mode });
      set({ themeMode: mode });
    } catch (err) {
      console.error('[theme-store] Failed to update theme settings:', err);
    }
  },

  hydrateTheme: () => {
    try {
      const settings = getSettings();
      if (settings && settings.theme) {
        set({ themeMode: settings.theme });
      }
    } catch {
      // settings might not be initialized yet during early boot
    }
  },
}));

/**
 * Hook to retrieve the active theme ('light' | 'dark') reactively.
 * Re-renders on theme mode updates or system scheme transitions.
 */
export function useActiveTheme(): 'light' | 'dark' {
  const themeMode = useThemeStore((s) => s.themeMode);
  const systemScheme = useColorScheme();

  if (themeMode === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return themeMode;
}
