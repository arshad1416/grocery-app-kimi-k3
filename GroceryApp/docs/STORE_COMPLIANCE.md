# PantryRun — Store Compliance Reference

> **Updated:** July 28, 2026 | **App version:** v1.30.0 | **Package:** `com.shiftlogichq.pantryrun`

This document contains all declarations needed for Google Play Console and Apple App Store Connect submissions.

> **v1 declaration basis — read this first.** The v1 binary sends **no user data
> to developer-controlled servers and no data to any third party that retains
> it** (see the data-flow truth table in `GOAL_PROMPT_NOTES.md`, Goal 6):
> Sentry is not configured in any v1 build (no DSN anywhere, `initSentry()`
> exits before initializing), the Turso-backed features are compiled out with
> no credential path, and all sync/flyer traffic goes exclusively to the
> user's **own self-hosted relay** (the managed tier is hidden in v1). The only
> third-party endpoint is the **opt-in** Open Food Facts barcode lookup, which
> sends the barcode number alone — no account, device ID, or list data — to
> service the request. Both stores' forms below are therefore answered as
> **no data collected**. If any of this changes (Sentry DSN added, managed
> relay enabled, Turso restored), these forms MUST be re-answered first.

---

## 0. Export Compliance (Encryption) — REQUIRED, EASY TO GET WRONG

PantryRun implements real end-to-end encryption (libsodium XChaCha20-Poly1305,
Argon2id, Ed25519, Curve25519, RFC 9474 blind RSA). This is more than
HTTPS/OS-provided crypto, so it does NOT qualify for Apple's "exempt" answer.

### iOS
- `ITSAppUsesNonExemptEncryption` is set to `true` in `app.json` (ios.infoPlist).
- In App Store Connect's encryption questions answer:
  - *Does your app use encryption?* → **Yes**
  - *Does your app qualify for any of the exemptions?* → **No**
  - *Does your app implement proprietary or non-standard encryption?* → **No**
    (all algorithms are standard, published ones via libsodium)
  - *Is your app going to be available in France?* → if yes, France has its own
    declaration; standard-algorithm mass-market apps use the simplified process.
- US export classification: mass-market software using standard cryptography →
  self-classify as **5D992.c** under License Exception ENC §740.17(b)(1) and
  email the annual **self-classification report** to BIS + NSA
  (crypt-supp8@bis.doc.gov, enc@nsa.gov) — one line item, once per year.

### Google Play
- Play Console asks about export compliance in **App content → Government
  regulations** (wording varies). Answer consistently with the above: uses
  standard encryption for user-data protection; mass-market; self-classified
  5D992.c.

---

## 1. Google Play — Data Safety Section

Navigate to: **Play Console → PantryRun → App Content → Data Safety**

### Data Collection Overview

**Does your app collect or share any of the required user data types?**
→ **No**

Google treats data as "collected" when it is transmitted off the device to the
developer or third parties, with exemptions for on-device processing, for
transfers the user initiates to a destination the user controls, and for
ephemeral processing. Every v1 flow falls under those exemptions:

| Flow | Destination | Why it is not "collection" |
|------|-------------|-----------------------------|
| Grocery lists / sync blobs | User's **own self-hosted relay** | User-installed, user-controlled server; payloads are end-to-end encrypted ciphertext unreadable by anyone but the family's devices; auto-expire after 30 days |
| Device pairing token (generated public key) | User's own self-hosted relay | Same user-controlled destination; random app-generated key, not a hardware or advertising ID |
| Flyer photo (optional, EXIF-stripped) | User's own self-hosted relay | User-initiated, user-controlled destination; processed in memory and discarded |
| Barcode number (opt-in) | Open Food Facts public database | Ephemeral request servicing: the barcode digits alone are sent to fetch a product name; no identifier accompanies the request and nothing is retained by the developer |
| Crash reports | — | **None sent.** No Sentry DSN is configured in any v1 build; the SDK never initializes |

**Nothing is shared with third parties.** There are no analytics or
advertising SDKs in the binary (no Firebase, no AdMob, no tracking of any
kind — pinned by `__tests__/ac15-no-analytics.test.ts`).

### Security Practices

| Practice | Status |
|----------|--------|
| Data is encrypted in transit | ✅ Yes |
| Data is encrypted at rest | ✅ Yes (XChaCha20-Poly1305) |
| Users can request data deletion | ✅ Yes |
| Committed to following the Families Policy | ❌ No (not targeted at children) |
| Follows Google Play Families Policy | ❌ No |

### Data Safety Form Answers (Copy-Paste Ready)

**Does your app collect or share any of the required user data types?**
→ No

(With "No" selected, Play skips the per-type questions. The deletion question
below appears in App content → Data deletion; answer it as follows.)

**Do you provide a way for users to request that their data is deleted?**
→ Yes — in-app: Settings → Delete All Data (works without any account; there
are no accounts). Relay-side encrypted blobs expire automatically within 30
days and are undecryptable once the local keys are destroyed.

**URL of your app's privacy policy:**
→ `https://groceryapp.app/privacy`

---

## 2. Apple App Store — App Privacy Labels

Navigate to: **App Store Connect → PantryRun → App Privacy**

### Privacy Label Configuration

Click "Edit" next to App Privacy and configure as follows:

#### Data Used to Track You
→ **No** — PantryRun does not track users across apps or websites.

#### Data Linked to You
→ **No** — PantryRun does not link any collected data to the user's identity.

#### Data Collected

Select **"No, we do not collect data from this app"**.

Apple's definition of "collect" is transmitting data off the device in a way
that is accessible to the developer or third-party partners for longer than
necessary to service the request. Nothing in v1 meets that definition:

| Flow | Why it is not "collected" under Apple's definition |
|------|-----------------------------------------------------|
| Sync blobs / pairing key / flyer photos → user's own self-hosted relay | The destination is a server the user installs and controls; the developer never has access. Sync payloads are additionally E2E-encrypted ciphertext |
| Barcode number → Open Food Facts (opt-in) | Sent solely to service the lookup request, with no identifiers; not retained by or accessible to the developer |
| Crash Data | Not transmitted at all — no Sentry DSN exists in any v1 build and the SDK never initializes |

This matches `NSPrivacyCollectedDataTypes: []` in `app.json` — the empty array
is **deliberate**, not an omission.

### Privacy Nutrition Label Summary (What Users See)

```
Data Not Collected

The developer does not collect any data from this app.

Data Used to Track You: None
Data Linked to You:     None
Data Not Linked to You: None
```

### Privacy Policy URL for App Store Connect
→ `https://groceryapp.app/privacy`

---

## 3. Apple Privacy Manifest (NSPrivacyManifest)

Already configured in `app.json` under `expo.ios.privacyManifests`:

```json
{
  "NSPrivacyTracking": false,
  "NSPrivacyTrackingDomains": [],
  "NSPrivacyAccessedAPITypes": [
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",
      "NSPrivacyAccessedAPITypeReasons": ["C617.1"]
    },
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
      "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]
    },
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime",
      "NSPrivacyAccessedAPITypeReasons": ["35F9.1"]
    },
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace",
      "NSPrivacyAccessedAPITypeReasons": ["E174.1"]
    }
  ],
  "NSPrivacyCollectedDataTypes": []
}
```

### API Reason Codes Explained

| API | Reason Code | Explanation |
|-----|-------------|-------------|
| File Timestamp (C617.1) | App uses file timestamps for database sync versioning |
| UserDefaults (CA92.1) | App stores user preferences and settings locally |
| System Boot Time (35F9.1) | Used for performance timing and session management |
| Disk Space (E174.1) | Checked before database operations to prevent corruption |

---

## 4. Store Listing — Required Links & Text

### Google Play Store Listing

**Privacy Policy URL:**
```
https://groceryapp.app/privacy
```

**Short Description (80 chars max):**
```
Privacy-first grocery lists. Encrypted, self-hosted family sync. No accounts needed.
```

**Full Description excerpt for privacy:**
```
🔒 PRIVACY-FIRST
• Your data stays on YOUR device — encrypted end to end
• No accounts, no sign-ups, no ads, no analytics, no tracking
• Family sync through YOUR OWN self-hosted server — we never see your data
• Open about how it works: read our privacy policy at groceryapp.app/privacy
```

### Apple App Store Listing

**Privacy Policy URL:**
```
https://groceryapp.app/privacy
```

**Support URL:**
```
https://groceryapp.app
```

---

## 5. Runtime Permission Rationale Strings

### Android (for `shouldShowRequestPermissionRationale`)

#### Camera
**Title:** `Camera Access`
**Message:** `PantryRun uses your camera to scan barcodes, scan QR pairing codes, and photograph store flyers for price extraction. Barcode/QR frames are processed in real-time and discarded. Flyer photos are sent (without location metadata) to your relay server for AI extraction, then discarded.`

#### Microphone
**Not requested in v1.** The app declares no RECORD_AUDIO permission and never
touches the microphone — "voice input" is an on-device text modal. This
rationale block returns only if a real voice feature ships.

#### Notifications (Android 13+)
**Title:** `Notification Permission`
**Message:** `PantryRun sends local notifications for shopping reminders and family list updates. No remote push notifications — all notifications come from the app on your device.`

### iOS (Info.plist strings — already in app.json)

| Key | Value |
|-----|-------|
| NSCameraUsageDescription | Scan barcodes to add items to your grocery list, scan QR codes to join your family, and photograph store flyers for price extraction |
| NSPhotoLibraryUsageDescription | Select a store flyer photo from your library so PantryRun can read its prices |
| NSLocalNetworkUsageDescription | PantryRun connects to your self-hosted sync relay on your local network to keep your family's grocery lists in sync |
| ITSAppUsesNonExemptEncryption | true (see Section 0) |

> Microphone and speech-recognition purpose strings, the Siri entitlement, and
> the App Group entitlement were **removed for v1** (2026-07-28): no voice
> feature ships ("voice input" is an on-device text modal that never touches
> the microphone), and an unused mic/Siri declaration invites reviewer
> questions the app cannot answer. Restore them only when a real voice feature
> ships.

---

## 6. Sentry — NOT ACTIVE IN v1

**No v1 build contains a Sentry DSN** (owner decision, 2026-07-28): `eas.json`
carries no `EXPO_PUBLIC_SENTRY_DSN`, no EAS dashboard env vars are set, and
`src/services/sentry.ts` exits before `Sentry.init()` when the DSN is empty.
Crash Data is therefore NOT declared on either store — declaring it for an SDK
that never initializes would be an over-declaration.

### Re-enabling later (all four steps or none):
1. Put the real DSN in `eas.json` → `build.production.env.EXPO_PUBLIC_SENTRY_DSN`.
2. Re-declare **Crash Data** (Apple: Crash Data → App Functionality; Play:
   App info and performance → Crash logs, shared with Sentry).
3. Restore the Crash Reporting section of `privacy/index.html` and the
   PrivacyScreen toggle (the `sentryEnabled` setting still exists and defaults
   to on — the code path is ready).
4. Keep `sendDefaultPii: false` and the breadcrumb stripping already in
   `sentry.ts`.

---

## 7. Managed vs Self-Hosted — What Differs for Compliance

> **v1 note:** the Managed tier is **hidden** (`MANAGED_TIER_ENABLED = false`
> in SettingsScreen.tsx) — its un-buyable subscription-key field risked Apple
> 3.1.1 rejection and must never ship alongside a live IAP flow. **Update
> (Goal 7, 2026-07-28, builds ≥ 1.31.0):** the app now HAS an in-app purchase
> path — the `pantryrun_plus_annual` auto-renewing subscription (PantryRun
> Plus, $14.99/yr) unlocking the Trip Optimizer, implemented via
> react-native-iap with all entitlement logic in
> `src/config/entitlements.ts`. Store questionnaires for such builds answer
> "has in-app purchases: yes" — see `audit-package/08-SUBMISSION-HANDOFF.md`
> §5 for the exact console answers; the no-data-collection privacy posture is
> unchanged. The Managed tier itself stays hidden; this table
> documents both modes for when the managed tier returns with its own IAP
> (see docs/MONETIZATION.md).

| Aspect | Self-Hosted | Managed |
|--------|-------------|---------|
| **Relay server** | User runs it | ShiftLogic runs it |
| **Data at rest on server** | Encrypted blobs only (30-day retention, `UPDATE_TTL_MS`) | Encrypted blobs only (30-day retention) |
| **Privacy policy disclosure** | "You run your own server" | "We relay encrypted data" |
| **Data safety form** | No server-side data | Relay logs (device IDs, timestamps) |
| **GDPR/data deletion** | In-app Delete All Data + 30-day relay auto-expiry | Email request to privacy@ |
| **Price scraping** | Allowed (self-host only) | Not available |
| **Crash reporting** | None in v1 (no Sentry DSN) | None in v1 |

For Google Play and Apple, the managed tier is the one that needs compliance disclosure since it involves a third-party server. The self-hosted tier has no server-side data collection by definition.

---

## 8. Checklist: Before Submitting

### Google Play Console
- [ ] Data Safety form filled (see Section 1 — "No" to collection; deletion answer per Section 1)
- [ ] Export compliance / government regulations answered (see Section 0)
- [ ] Privacy policy URL added: `https://groceryapp.app/privacy`
- [ ] `INTERNET` permission justified
- [ ] `READ_EXTERNAL_STORAGE` maxSdkVersion=32 justified
- [ ] No SYSTEM_ALERT_WINDOW (removed)
- [ ] Target API level meets Play's floor. As of July 2026 the app targets
      **SDK 35 (Android 15)** — Expo SDK 56's default (`ExpoRootProjectPlugin.kt`
      targetSdk fallback "35"; no override in this project) — which satisfies
      the current requirement for new apps. **From August 31, 2026, new apps
      and updates must target SDK 36 (Android 16)** — if submitting after that
      date, bump the target first. Source:
      https://support.google.com/googleplay/android-developer/answer/11926878
      (checked 2026-07-28)
- [ ] Release bundle signed with the upload keystore (PANTRYRUN_UPLOAD_* gradle
      props or EAS credentials) — NOT the debug keystore
- [ ] versionCode/versionName in android/app/build.gradle match app.json

### Apple App Store Connect
- [ ] App Privacy labels configured (see Section 2 — "Data Not Collected")
- [ ] Encryption questions answered (see Section 0); ITSAppUsesNonExemptEncryption=true in build
- [ ] Annual BIS self-classification report filed (5D992.c)
- [ ] Privacy policy URL added: `https://groceryapp.app/privacy`
- [ ] Privacy manifest included in build (via app.json)
- [ ] Info.plist usage descriptions present
- [ ] No tracking (NSPrivacyTracking = false)
- [ ] apple-app-site-association deployed at
      https://groceryapp.app/.well-known/apple-app-site-association with the
      real Team ID (repo copy has TEAMID placeholder)

### In-App
- [ ] Privacy screen accessible from Settings
- [ ] Delete All Data flow works (confirmation → wipe → fresh state)
- [ ] Price lookup opt-in with disclosure works
- [ ] Barcode lookup consent prompt shows before first scan
- [ ] Permission rationale modal shows before OS dialog
- [ ] Links to privacy policy and ToS work
