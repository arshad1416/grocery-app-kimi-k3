# Google Play Readiness — Pass/Fail per Policy

Assessed against Google Play policies / Console requirements as of July 2026,
from the actual code/config at `b9d959d6`.
Legend: ✅ PASS · ⚠️ CONDITIONAL (named owner action) · ❌ FAIL today · ➖ N/A.

## Technical requirements

| Policy / requirement | Verdict | Evidence / action |
|---|---|---|
| Target API level ≥ 34 (Android 14+) | ✅ | Expo SDK 56 root plugin supplies target/compile SDK ≥ 34. |
| App Bundle (.aab) release format | ⚠️ | EAS production build produces an .aab; **action: run the production build** (never done this cycle). |
| Release signing (no debug keystore) | ❌ | Upload keystore **not generated yet**. Gradle is pre-wired for `PANTRYRUN_UPLOAD_*` props and deliberately falls back to debug signing only for local builds (Play rejects debug-signed bundles, so this can't slip through silently). **Action (owner): `keytool -genkeypair …` or `eas credentials`, then back the keystore up.** |
| versionCode / versionName consistency | ✅ | versionCode 30 / versionName 1.30.0, matches app.json (was mismatched; fixed this cycle). |
| Crash-free basic functionality | ⚠️ | Same caveat as Apple 2.1: all suites green but **no physical-device run this cycle**. Action: smoke test on a real Android device. |
| 16 KB page-size compatibility (Play requirement for new apps, 2025+) | ⚠️ | Expo 56 toolchain builds 16 KB-aligned by default; **verify in the first production build artifact** (`zipalign` check) rather than assuming. |

## Data safety & privacy

| Policy | Verdict | Evidence / action |
|---|---|---|
| Data safety form | ⚠️ | Complete, code-accurate answers prepared in `docs/STORE_COMPLIANCE.md` §1 — including the easy-to-miss **Photos row** (flyer scans upload an EXIF-stripped image to the user's relay, ephemeral, optional) and crash logs (Sentry, optional, shared). **Action: transcribe into Play Console.** Mis-declared data safety is Google's most common takedown trigger for privacy-marketed apps. |
| Privacy policy URL (required for the form) | ❌→⚠️ | Policy file exists in-repo; **not hosted yet** at `https://groceryapp.app/privacy`. Owner action; blocks form submission. |
| Account deletion requirement | ➖/✅ | No accounts exist. In-app: Leave Family, Clear Local Prices; uninstall removes all local data. Document "no account" in the form. |
| Permissions declarations | ✅ | Runtime permissions: Camera (expo-camera merge), POST_NOTIFICATIONS (Android 13+), storage capped at maxSdkVersion 32. No SMS/Call-log/背景location — nothing needing a sensitive-permission declaration form. |
| Prominent disclosure & consent | ✅ | Pricing opt-in enforced in code (fail-closed registry gate); flyer upload disclosed in-flow; Sentry toggleable. |
| Families policy | ➖ | Not targeting children; select 13+ / adult target audience in Console to stay out of Families requirements. |
| Ads | ✅ | None (no ad SDK; pinned by ac15-no-analytics test). Declare "no ads". |

## Store listing & assets

| Requirement | Verdict | Action |
|---|---|---|
| Title (≤30), short description (≤80), full description | ⚠️ | Ready to paste from `06-MARKETING-KIT.md`. |
| Screenshots (≥2 phone; 7"/10" tablet if claiming tablet) | ❌ | **Not created.** Minimum: 4-6 phone screenshots of list, shared sync, price badges, trip optimizer, flyer scan. |
| Feature graphic (1024×500) | ❌ | **Not created** — required for listing. |
| App icon 512px | ✅ | Derivable from `assets/icon.png`. |
| Content rating questionnaire | ⚠️ | Straightforward "Everyone" answers; owner completes in Console. |
| App category & contact details | ⚠️ | Suggest House & Home or Shopping; support email required — set up `support@groceryapp.app` (or use owner email). |

## App Links / integrations

| Item | Verdict | Evidence / action |
|---|---|---|
| `assetlinks.json` for autoVerify App Links | ⚠️ | Template in-repo (`android/assetlinks.json`) + hosting guide (`docs/DEEP-LINK-HOSTING.md`). **Action: insert the signing-cert SHA-256 (from Play App Signing, not just the upload key) and host at `/.well-known/`.** Custom-scheme invites work without it. |
| Intent filters | ✅ | autoVerify filter is https-only; custom scheme in its own filter (fixed this cycle). |
| Cleartext traffic | ✅/⚠️ | `usesCleartextTraffic: true` is justified (self-hosted `ws://` relays on LAN) and documented in app.json; acceptable, but expect no pushback only if the listing/privacy policy explains self-hosting — it does. |

## Export compliance
Same substance as Apple (see `02-APPLE-READINESS.md` §Export): Play's
government-regulations question answered per `STORE_COMPLIANCE.md` §0;
US BIS self-classification email is the same single action covering both
stores.

## Bottom line (Google)
**Not submittable today**, for owner-side reasons only: (1) generate + back up
the upload keystore, (2) host the privacy policy, (3) produce screenshots +
feature graphic, (4) run one production .aab build and a real-device smoke
test, (5) transcribe the prepared data-safety answers. Code and config are
ready; the two historic auto-reject landmines (debug signing, version
mismatch) were fixed this cycle and are pinned so they can't regress silently.
