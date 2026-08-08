# PantryRun — Submission Handoff (Owner Checklist)

Written 2026-07-28 (Goal 6). This is the single document that takes you from
here to the **Submit** button on both consoles. Every field below is
paste-ready; every action that needs a login, a purchase, or a publish is
yours — the agent never touches a console.

**Basis for every privacy answer below:** the v1 data-flow truth table in
`GOAL_PROMPT_NOTES.md` (Goal 6). Summary: v1 collects **nothing** — no
Sentry (no DSN in any build), no Turso (compiled out), all sync/flyer traffic
goes only to the user's own self-hosted relay, and the only third-party
endpoint is the opt-in Open Food Facts barcode lookup (barcode digits only,
ephemeral). If you change ANY of that (add a Sentry DSN, enable the managed
tier, restore Turso), the privacy answers in this document become false and
must be redone first.

**Goal 7 update (2026-07-28):** the tree now carries **PantryRun Plus**
(v1.31.0, versionCode 31) — an auto-renewing subscription via react-native-iap
that unlocks the Trip Optimizer. If you submit this build, ALSO complete
**section 5 (In-App Purchase addendum)** below. The no-collection privacy
posture above still holds (see 5.3). If instead you submit the pre-Plus free
v1 first (release-strategy decision, GOAL_PROMPT_NOTES.md Goal 7 handoff
item 1), sections 0–4 apply unchanged and section 5 applies to the 1.31
update.

---

## 0. Do these before either console (in order)

1. **Generate the Android upload keystore** (never enters the repo):
   ```bash
   "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
     -genkeypair -v -keystore ~/pantryrun-upload.keystore \
     -alias pantryrun-upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Back it up off-machine. Losing it without Play App Signing = locked out of updates.
2. **Host the privacy policy** at `https://groceryapp.app/privacy` — publish
   `GroceryApp/privacy/index.html` (this is a public publish; it is the URL
   both consoles require). The file was rewritten 2026-07-28; host THIS version.
3. **Host the association files** at `https://groceryapp.app/.well-known/`:
   - `apple-app-site-association` from `GroceryApp/ios/apple-app-site-association`
     — replace `TEAMID` with your real 10-character Team ID (Apple Developer →
     Membership) and strip the `_comment` key. Serve as `application/json`, no redirect.
   - `assetlinks.json` from `GroceryApp/android/assetlinks.json` — replace the
     SHA-256 placeholder with the **App signing key** fingerprint from Play
     Console → Setup → App integrity (after step 5 below).
4. **Install EAS CLI and log in** (`npm install -g eas-cli && eas login`).
   No environment variables are needed on the production profile — the app
   ships with no Sentry DSN by design (owner decision 2026-07-28). Do not add
   any `EXPO_PUBLIC_*` variable to the EAS dashboard without redoing the
   privacy declarations.
5. **Build the store artifacts**:
   ```bash
   cd GroceryApp
   eas build --profile production --platform android   # .aab
   eas build --profile production --platform ios       # .ipa
   ```
   (Local Android alternative: `./gradlew bundleRelease` with the four
   `-PPANTRYRUN_UPLOAD_*` props pointing at your keystore.)
6. **Capture screenshots and the preview video** — see section 3. NOT done
   this session (no signed build; the flyer camera path is broken). Never
   substitute mockups: Apple 2.3.3 and Play both require footage of the real
   running app.

---

## 1. Apple App Store Connect

### 1.1 Create the app record
| Console asks | Enter |
|---|---|
| Platform | iOS |
| Name | `PantryRun: Family Grocery List` (30/30 chars) |
| Primary language | English (Canada or U.S. — your call) |
| Bundle ID | `com.shiftlogichq.pantryrun` — **permanent the moment this record is created**; last chance to rename is before this step |
| SKU | `pantryrun-v1` (internal only) |

### 1.2 App Information
| Field | Value |
|---|---|
| Subtitle | `Private shared lists & prices` (29/30) |
| Category | Primary: Shopping · Secondary: Food & Drink |
| Content rights | Does not contain third-party content |
| Age rating questionnaire | Answer "No" to every content descriptor → **4+** |
| Privacy Policy URL | `https://groceryapp.app/privacy` |
| Support URL | `https://groceryapp.app` |

### 1.3 Pricing & Availability
| Console asks | Answer |
|---|---|
| Price | **Free (Tier 0)** |
| In-app purchases | **None** — do not create any IAP record; v1 has no purchase path (Apple 3.1.1 posture) |

### 1.4 App Privacy (the nutrition label)
Console: App Privacy → Get Started.

| Console asks | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app** |

That is the entire form. The label will read **"Data Not Collected"**. Why
this is true: see `GroceryApp/docs/STORE_COMPLIANCE.md` §2 — nothing reaches
developer-controlled servers; sync/flyer data goes only to the user's own
relay; the opt-in Open Food Facts barcode lookup sends the barcode digits
alone to service the request; no Sentry DSN exists in the build. This matches
`NSPrivacyCollectedDataTypes: []` in `app.json` (deliberately empty).

### 1.5 Export compliance (encryption)
Asked at build submission. The app sets `ITSAppUsesNonExemptEncryption=true`.

| Console asks | Answer |
|---|---|
| Does your app use encryption? | **Yes** |
| Does your app qualify for any of the exemptions? | **No** |
| Does your app implement proprietary or non-standard encryption? | **No** (libsodium standard algorithms) |
| Available in France? | If yes, use the simplified mass-market declaration |

Plus (yearly, outside the console): email the BIS self-classification report
for 5D992.c to crypt-supp8@bis.doc.gov and enc@nsa.gov — one line item.
Details: `GroceryApp/docs/STORE_COMPLIANCE.md` §0.

### 1.6 App Review notes (paste into "Notes" so the reviewer isn't lost)
> PantryRun is fully usable without any account or server: create lists,
> add items, scan flyers from photos. Family sync is an optional feature that
> connects to a relay server the USER hosts themselves (open source; we run
> no servers and cannot provide demo credentials because none exist). There
> is no login. Data deletion: Settings → Delete All Data.

### 1.7 Media slots (per size class)
| Slot | Size | Filename convention |
|---|---|---|
| iPhone 6.9" screenshots (required, up to 10) | 1320×2868 | `ios-69-01.png` … `ios-69-08.png` |
| iPhone 6.5" screenshots (recommended) | 1284×2778 | `ios-65-01.png` … |
| iPad 13" screenshots (**required while `supportsTablet: true`** — either capture these or flip `supportsTablet` to false in app.json before building) | 2064×2752 | `ipad-13-01.png` … |
| App Preview video (optional, 15–30 s, portrait, on-device footage only) | per size class | `ios-preview-69.mp4` |

Shot list and storyboard: `audit-package/07-STORE-LISTINGS.md` §4–5.

---

## 2. Google Play Console

### 2.1 Create the app
| Console asks | Enter |
|---|---|
| App name | `PantryRun: Family Grocery List` (30/30) |
| Default language | English |
| App or game | App |
| Free or paid | **Free** (permanent once published) |
| Package name (fixed at first upload) | `com.shiftlogichq.pantryrun` |

### 2.2 Store listing
| Field | Value |
|---|---|
| Short description (80) | `Private, encrypted family grocery lists. Offline-first, no accounts, no ads.` (76/80) |
| Full description (4000) | The description block in `audit-package/07-STORE-LISTINGS.md` §2 (emoji variant in `06-MARKETING-KIT.md` §1 if preferred) |
| App icon | 512×512 (from `GroceryApp/assets/icon.png`, exported) |
| Feature graphic | 1024×500 — spec in `07-STORE-LISTINGS.md` §4 |
| Phone screenshots | min 2, max 8, ≥1080 px wide, 9:16 — `android-01.png` … `android-08.png` |
| Category | Shopping; tags: shopping list, family organizer |
| Contact email | your support address |

### 2.3 App content → Data safety
| Console asks | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |

(Play then skips the per-type grid.) Justification if ever questioned:
`GroceryApp/docs/STORE_COMPLIANCE.md` §1 — user-controlled self-hosted
destination, E2EE ciphertext, ephemeral barcode lookup, no crash reporting.

### 2.4 App content → Data deletion
| Console asks | Answer |
|---|---|
| Do you provide a way for users to request that their data is deleted? | **Yes** |
| Deletion method | In-app: **Settings → Delete All Data** (no account required — the app has no accounts). Relay-side encrypted blobs auto-expire within 30 days and are undecryptable once the local keys are destroyed. |

### 2.5 App content → remaining declarations
| Console asks | Answer |
|---|---|
| Privacy policy URL | `https://groceryapp.app/privacy` |
| Ads | **No, my app does not contain ads** |
| App access | **All functionality is available without special access** (no login; if the reviewer asks about sync, paste the review note from §1.6) |
| Content rating questionnaire (IARC) | Category: Utility/Productivity; answer **No** to all violence/sex/language/controlled-substance/gambling questions; **No** user-generated content visible to others (family sharing is private, invite-only, E2EE) → expect **Everyone** |
| Target audience | 18 and over (do NOT tick under-13 — avoids Families policy) |
| News app | No |
| COVID-19 tracing/status | No |
| Data safety – encryption in transit | Yes |
| Government/export compliance (wording varies) | Standard encryption (libsodium), mass-market, self-classified 5D992.c — same answers as Apple §1.5 |

### 2.6 Release
| Step | Value |
|---|---|
| Track | Production (or Internal testing first — recommended for the two-device smoke test) |
| Artifact | The `.aab` from EAS/Gradle, signed with the upload keystore; **enroll in Play App Signing** when prompted |
| Target API level | Targets SDK 35 (Android 15) — meets the floor today. **From Aug 31, 2026 new apps must target SDK 36** (source: https://support.google.com/googleplay/android-developer/answer/11926878). If submitting after that date, bump `targetSdkVersion` first |
| versionCode / versionName | 30 / 1.30.0 (already coherent in the repo) |

---

## 3. Screenshots & video — status and pipeline

**Status: NOT captured this session.** Blockers: no signed production build
existed during this goal, and the flyer camera path is broken
(`audit-package/00-README.md`) — shot 4 and the 15–20 s video beat must use
the photo-library path. **Never fabricate mockups** (Apple 2.3.3 / Play
metadata policy).

Capture pipeline (owner runs; full details in `07-STORE-LISTINGS.md` §4–5):
```bash
# iOS simulator (Xcode 26.6 is installed on this Mac)
cd GroceryApp && npx expo run:ios --device "iPhone 16 Pro Max"
xcrun simctl status_bar "iPhone 16 Pro Max" override --time "9:41" --batteryState charged --batteryLevel 100
xcrun simctl io booted screenshot ios-69-01.png
xcrun simctl io booted recordVideo ios-preview-69.mp4

# Android emulator (SDK + JBR already on this Mac; emulator-5554 used in Goal 5)
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" npx expo run:android
adb -s emulator-5554 exec-out screencap -p > android-01.png
```
Seed list: milk, eggs, bread, chicken thighs, bananas, coffee + CAD prices.
The 8 shots and the 30-second storyboard are in `07-STORE-LISTINGS.md`.

---

## 4. Owner action list (batched — everything the agent cannot do)

| # | Action | Why |
|---|---|---|
| 1 | Log in: Apple Developer / App Store Connect, Google Play Console | All console work; agent never authenticates |
| 2 | Supply the Apple **Team ID** and deploy the two association files (§0.3) | Universal Links / App Links verification |
| 3 | Generate + back up the **upload keystore** (§0.1); enroll Play App Signing | Android release signing |
| 4 | Confirm the display name before creating the Apple record | `com.shiftlogichq.pantryrun` and the name lock in at §1.1 |
| 5 | Host `privacy/index.html` at the public URL (explicit publish) | Both consoles require the URL live at review time |
| 6 | Run the device smoke test, then capture screenshots + video (§3) | Store media must be real footage; camera-path bug limits flyer beats to photo-library |
| 7 | ~~Fix `GroceryApp/relay-server/public/invite-redirect.html` Play package id (`com.groceryapp.app` → `com.shiftlogichq.pantryrun`) before hosting it~~ **DONE (2026-07-28):** Fixed Play package ID + app scheme typo (`grocceryapp://` → `groceryapp://`) + title/branding (GroceryApp → PantryRun) + iOS URL cleanup. Only the iOS App Store numeric ID placeholder (`idXXXXXXXXXX`) remains — replace once the ASC record is created. |
| 8 | File the annual BIS self-classification email (§1.5) | Export compliance |
| 9 | Fill both consoles' forms with the answers above and press **Submit** | Final human-only step |

If you submit after **August 31, 2026**, also bump the Android target SDK to
36 first (§2.6).

---

## 5. In-App Purchase addendum — PantryRun Plus (Goal 7, 2026-07-28)

Applies to any build ≥ 1.31.0 (versionCode ≥ 31). The subscription unlocks
the Trip Optimizer for the whole family; entitlement logic lives solely in
`GroceryApp/src/config/entitlements.ts`.

### 5.1 Create the products (before submitting the build for review)

**App Store Connect → (app) → Monetization → Subscriptions:**
| Field | Value |
|---|---|
| Subscription Group | `PantryRun Plus` (new group) |
| Reference Name | `PantryRun Plus Annual` |
| Product ID | `pantryrun_plus_annual` — must match the code constant exactly |
| Duration | 1 year |
| Price | **USD $14.99/yr** (choose the matching CAD tier Apple proposes) |
| Localization (en-US, en-CA) | Display name `PantryRun Plus`; description `Unlocks the Trip Optimizer for your whole family: the cheapest way to split your list across nearby stores, with savings shown vs. the cheapest single store.` |
| Review screenshot | The paywall alert — capture from a device (same as `/tmp/pantryrun-goal7-proof/04-paywall-alert.png`, recapture on your build) |

Attach the subscription to the app version before pressing Submit — the
first IAP must be submitted WITH a version review.

**Play Console → (app) → Monetize → Subscriptions:**
| Field | Value |
|---|---|
| Product ID | `pantryrun_plus_annual` |
| Name | `PantryRun Plus` |
| Base plan ID | `annual` — exactly ONE base plan (auto-renewing, 1 year, $14.99); the client passes an empty offerToken and relies on the single base plan |
| Benefits/description | same copy as Apple's localization above |

### 5.2 Test accounts (needed before the purchase test cases can run)
- Sandbox tester Apple ID: App Store Connect → Users and Access → Sandbox → Testers.
- Play license tester: Play Console → Settings → License testing (add a Google account; also add it as a tester on an internal-testing track carrying build ≥ 31).
Report both back — three purchase cases (purchase→relaunch; second family device; uninstall→reinstall→recovery-restore) are prepared and waiting on these.

### 5.3 Privacy answers — what the IAP changes (and what it doesn't)
- **Apple privacy label: stays "Data Not Collected"; `NSPrivacyCollectedDataTypes` stays `[]`.** Reasoning to keep on file (and in review notes): the purchase runs through StoreKit/Play Billing directly between the user and the store; the app keeps the entitlement on-device and syncs it end-to-end encrypted through the user's own relay; no purchase data is transmitted to developer-controlled servers, and there is no server-side receipt validation in this release. "Purchases" is declared only when the developer collects purchase data off-device — we do not.
- **Play Data safety: unchanged** ("does not collect or share any required user data types"). The separate monetization question — "does your app have in-app purchases?" — becomes **Yes** (this is a store-listing attribute, not a data-safety answer; Play detects the BILLING permission and will expect it).
- **Apple "paid digital content" / content-rights questions: Yes** — in-app purchases present, you hold the rights.
- App Review notes (§1.6): append — `v1.31 adds one auto-renewing subscription (pantryrun_plus_annual, $14.99/yr) unlocking the Trip Optimizer. Purchases go through StoreKit only; the entitlement record syncs end-to-end encrypted between the user's own devices. No account is required and no purchase data reaches our servers.`

### 5.4 Owner action list additions
| # | Action | Why |
|---|---|---|
| 10 | Decide the release path: free v1.30 first vs 1.31-with-Plus as initial submission | Determines whether §5 applies to the first review or an update (GOAL_PROMPT_NOTES.md Goal 7 handoff item 1) |
| 11 | Create both subscription products (§5.1) and approve the final price | Products are console-only; price approval is yours |
| 12 | Create sandbox + license testers (§5.2) and report back | Unblocks the three prepared purchase test cases |
| 13 | Run `eas build --platform all --profile production` on ≥ 1.31.0 and report the two build IDs | Recorded in GOAL_PROMPT_NOTES.md; the IAP SDK is a native dependency, so store artifacts must be rebuilt |

---

## Owner preconditions added by the 2026-08-08 hardening pass

`cd GroceryApp && npm run check:release` is the machine-checkable version of this
section. It runs in CI on every push (`.github/workflows/ci.yml`, "Release config
check"). It fails only on a *regression*; anything needing a human reports
PENDING and exits 0, so CI never has to hold a credential. As of this commit:
**16/19 passed, 3 pending owner action, 0 failed.**

### 14 — Initialise the EAS remote version counter BEFORE the next production build

`eas.json` now sets `cli.appVersionSource: "remote"` with `autoIncrement: true`
on the production profile, which is Expo's documented recommendation from EAS
CLI 12.0.0.

Per Expo's docs the remote counter is seeded from the local config, and
`app.json` still carries `android.versionCode: 31` / `ios.buildNumber: "31"`, so
the first remote build should land on 32. **Confirm rather than assume** — Play
rejects any versionCode ≤ 31, and 31 is already live in closed testing:

```bash
cd GroceryApp
eas build:version:get   --platform android
eas build:version:set   --platform android   # only if the remote value is < 31
eas build:version:set   --platform ios       # same check for buildNumber
```

If `build:version:get` reports nothing or a value below 31, set it to 31 before
building. Skipping this risks a rejected submission, not a broken build, so it
fails late and confusingly.

### 15 — Decide the Android cleartext posture (audit M5, deliberately left open)

`android/app/src/main/res/xml/network_security_config.xml` currently pins the
three public endpoints to HTTPS-only and leaves `base-config` permissive. That is
a **partial** fix and the check reports it PENDING on purpose.

Closing it fully is a **breaking change, not a config tweak**: Android's grammar
has no CIDR, and `includeSubdomains` matches a DNS suffix while the octet that
varies in an RFC1918 address is the suffix — so `192.168.0.0/16` is not
expressible without ~65k entries. `docs/self-host-security.md` tells self-hosters
to connect to a bare LAN IP, and React Native's WebSocket goes through OkHttp,
which consults `NetworkSecurityPolicy.isCleartextTrafficPermitted(host)`. Flipping
`base-config` to `false` therefore silently breaks sync for every self-hoster who
followed our own documentation — on a version already in closed testing.

Ship it together with a docs migration pointing LAN self-hosters at either a
hostname their router resolves or a `wss://` relay. Not `.local`: OkHttp does not
resolve mDNS without `NsdManager`, so such an entry would be decorative.

### 16 — Provide the two credentials CI cannot hold

- `credentials/play-service-account.json` — the Play upload key. Now covered by
  `.gitignore` (`credentials/`, `*play-service-account*.json`), verified with
  `git check-ignore -v`. Provision it locally; never commit it.
- `eas.json` `submit.production.ios.ascAppId` and `appleTeamId` are still the
  literal placeholders `REPLACE_WITH_…`. `eas submit --platform ios` fails until
  they hold real values. These are account facts an agent must not invent.

### 17 — Android submit track

`submit.production.android.track` is `internal`, the most restricted track,
deliberately chosen over `production`. The app is in **closed testing**, so
promote through the console once a build is verified rather than letting
`eas submit --profile production` push straight to the production track.
