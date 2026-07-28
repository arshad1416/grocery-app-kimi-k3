# Apple App Store Readiness — Pass/Fail per Guideline

Assessed against the App Store Review Guidelines as of July 2026, using the
actual code/config at `b9d959d6` (evidence from this repo, not intentions).
Legend: ✅ PASS · ⚠️ CONDITIONAL (pass once a named owner action is done) ·
❌ FAIL (will block or likely reject today) · ➖ N/A.

## Safety & Completeness

| # | Guideline | Verdict | Evidence / required action |
|---|---|---|---|
| 2.1 | App Completeness (no crashes, placeholder content, broken features) | ⚠️ | All 38 Jest suites green + tsc clean, join/sync/flyer flows wired — but the app has **never been run on physical devices this cycle**; native layer (SQLite, libsodium JSI, SecureStore) is mocked in tests. **Action: two-device smoke test** (create → invite → join → sync → offline kill → relaunch). Submitting without it risks a 2.1 rejection on the first crash. |
| 2.3.1 | Accurate metadata — app does what the listing says | ⚠️ | Use `06-MARKETING-KIT.md` copy, which claims only shipped features (no Alexa/Google claims — those are disabled in v1; no "managed plan" claims — hidden in v1). |
| 2.3.10 | No references to other platforms in metadata | ✅ | Kit copy contains none. |
| 2.5.1 | Public APIs only | ✅ | Expo SDK 56 + standard RN libs; no private API usage found. |
| 2.5.2 | No downloaded executable code | ✅ | No code-push/eval; OTA not configured. |

## Business

| # | Guideline | Verdict | Evidence |
|---|---|---|---|
| 3.1.1 | Digital purchases must use IAP | ✅ | v1 is fully free: managed tier + subscription-key UI hidden (`MANAGED_TIER_ENABLED=false`, SettingsScreen), no purchase or "upgrade" language anywhere in-app. The un-buyable "subscription key" field that risked a 3.1.1 flag is gone from the UI. |
| 3.1.3 | Reader/external-purchase rules | ➖ | Nothing purchasable in v1. Revisit when the premium tier ships (see `05-PREMIUM-FEATURES-PRICING.md`). |
| 3.2.2 | Unacceptable business model (artificially locked features) | ✅ | All shipped features usable without payment or account. |

## Design

| # | Guideline | Verdict | Evidence |
|---|---|---|---|
| 4.0 | Minimum functionality / not a thin wrapper | ✅ | Native full-featured app (lists, sync, camera, prices, optimizer). |
| 4.2.3 | Usable on launch without extra downloads | ⚠️ | Core list works offline/standalone. But first-run guidance is thin (see usability audit C-1/C-2) — a reviewer who taps Pairing and sees `ws://` URL jargon may probe 2.1. Low risk, worth the onboarding fix. |
| 4.8 | Login services (Sign in with Apple) | ➖ | No accounts, no third-party login at all. |
| 5.1.1(v) | Account deletion required if accounts exist | ➖/✅ | No accounts. In-app data controls exist anyway: Leave Family (unpair), Clear Local Prices, uninstall wipes local data. |

## Privacy (the make-or-break section for this app)

| # | Guideline | Verdict | Evidence / action |
|---|---|---|---|
| 5.1.1(i) | Privacy policy link required in metadata + app | ❌→⚠️ | Policy exists (`GroceryApp/privacy/index.html`, linked in-app from PrivacyScreen) but is **not yet hosted** at `https://groceryapp.app/privacy`. **Action (owner): deploy it.** Hard blocker for submission forms. |
| 5.1.1(ii) | Consent for data collection | ✅ | Pricing lookups are opt-in with disclosure (enforced in code — registry fail-closed gate); Sentry crash reporting is opt-out with a visible toggle; flyer-photo upload has per-use in-flow disclosure. |
| 5.1.2 | Data use/sharing limits | ✅ | No analytics/ads SDKs (pinned by ac15 test); endpoints inventoried in `docs/STORE_COMPLIANCE.md` §10. |
| — | Privacy nutrition labels accuracy | ⚠️ | Correct answers prepared in `STORE_COMPLIANCE.md` §2 (Crash Data, Device ID, Photos-ephemeral for flyer scans; nothing linked/tracking). **Action: enter them in App Store Connect exactly as written** — labels must match actual traffic, and these were derived from the real network behavior. |
| — | Privacy manifest (NSPrivacyAccessedAPITypes) | ✅ | Present in `app.json` with reason codes (FileTimestamp C617.1, UserDefaults CA92.1, SystemBootTime 35F9.1, DiskSpace E174.1); NSPrivacyTracking=false. |
| — | Permission purpose strings | ✅ | Camera (barcode/QR/flyer — string covers all three uses), Microphone, Speech Recognition present; mic/speech justified by the Siri entitlement. |

## Export Compliance (encryption) — commonly missed, this app cannot skip it

| Item | Verdict | Evidence / action |
|---|---|---|
| `ITSAppUsesNonExemptEncryption` declared | ✅ | `true` in `app.json` ios.infoPlist — correct for libsodium E2EE (this is *not* exempt-only crypto). |
| App Store Connect encryption questions | ⚠️ | Answer sheet ready in `STORE_COMPLIANCE.md` §0 (uses encryption: yes; exemption: no; proprietary: no — standard algorithms; mass-market 5D992.c). **Action: answer at submission.** |
| Annual BIS self-classification report | ⚠️ | **Action (owner): one-line email to crypt-supp8@bis.doc.gov + enc@nsa.gov** — required for US export compliance; template in §0. |
| France declaration (if distributing there) | ⚠️ | Simplified process for standard-algorithm mass-market apps; decide distribution territories first. |

## Technical / Assets

| Item | Verdict | Evidence / action |
|---|---|---|
| App icon (1024px) | ✅ | `assets/icon.png` (1024×1024 — exactly Apple's requirement). |
| Launch/splash screen (iOS) | ⚠️ | No iOS native splash configured (needs `expo-splash-screen` plugin — deliberately deferred to the first EAS build; Android splash exists). Not a rejection, but first impression is a blank frame. |
| Screenshots (6.7", 6.1", iPad if universal) | ❌ | **Not created.** `supportsTablet: true` means iPad screenshots are required too — either produce them or set `supportsTablet: false` for v1. |
| Universal Links | ⚠️ | Entitlement (`associatedDomains: applinks:groceryapp.app`) and AASA file are in-repo and correct; **action: replace TEAMID and host at `/.well-known/`** (instructions: `docs/DEEP-LINK-HOSTING.md`). Custom-scheme invites work regardless. |
| Signing / Team | ⚠️ | EAS-managed; **action: real Apple Developer account + Team ID** (also needed for the AASA file and Siri entitlement). |
| TestFlight pass | ❌ | Not done — same action as 2.1 device test; do them together. |

## Bottom line (Apple)
**Not submittable today.** Hard blockers are all owner-side, none are code:
(1) device/TestFlight smoke test, (2) host privacy policy, (3) screenshots
(or drop iPad support), (4) Team ID + AASA hosting, (5) answer encryption
questions + BIS email. The code-side posture (IAP, privacy labels prep,
manifest, export flag, permissions) is clean and consistent with what the app
actually does — which is exactly what Apple's reviewers check first for a
privacy-marketed app.
