/**
 * Sentry Initialization Service
 *
 * Reads the user's `sentryEnabled` preference from the settings store.
 * When the user has opted out, Sentry is never initialized — no SDK event
 * transport is created and no data leaves the device.
 *
 * When enabled, Sentry is configured with:
 *  - `sendDefaultPii: false` (no IP, no user ID, no breadcrumbs with PII)
 *  - Breadcrumb filtering that strips navigation params and HTTP bodies
 *
 * Call `initSentry()` once during app startup, after settings have been
 * loaded but before screen components mount.
 */

import * as Sentry from '@sentry/react-native';
import { getSettings } from '../config/settings';

// EXPO_PUBLIC_ prefix is required: the Expo bundler only inlines env vars
// carrying it, so a bare SENTRY_DSN would be empty in every built app.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/**
 * Conditionally initialize Sentry based on user opt-in preference.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initSentry(): Promise<void> {
  try {
    const settings = getSettings();
    const enabled = settings.sentryEnabled !== false; // default: true

    if (!enabled) {
      console.log('[sentry] Crash reporting disabled by user — skipping init');
      return;
    }

    if (!SENTRY_DSN) {
      console.warn('[sentry] No EXPO_PUBLIC_SENTRY_DSN configured — skipping init');
      return;
    }

    Sentry.init({
      dsn: SENTRY_DSN,
      debug: __DEV__,
      sendDefaultPii: false,
      // Strip potentially sensitive breadcrumb data
      beforeBreadcrumb(breadcrumb) {
        // Drop navigation breadcrumbs that may contain params with grocery data
        if (breadcrumb.category === 'navigation' && breadcrumb.data) {
          delete breadcrumb.data.params;
        }
        // Drop HTTP breadcrumbs that may contain request/response bodies
        if (
          (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') &&
          breadcrumb.data
        ) {
          delete breadcrumb.data.request_body;
          delete breadcrumb.data.response_body;
        }
        return breadcrumb;
      },
    });

    console.log('[sentry] Initialized (PII off, breadcrumb filtering on)');
  } catch (err) {
    console.warn('[sentry] Failed to initialize:', err);
  }
}
