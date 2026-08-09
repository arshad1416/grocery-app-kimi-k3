# PantryRun — ship readiness

State at `e4eeec3`. Goal set for this pass: **Android production, iOS first submission, and a
deployable hardened relay.** grocery-app retired.

## Verdict

| Target | State | What remains |
|---|---|---|
| **Relay** | **Ready to deploy** | Nothing in the code. Needs a host + TLS. |
| **Android** | **Ready to build and submit** | Verify the EAS remote version counter, then build. |
| **iOS** | **Code ready, unverifiable here** | Needs a signing identity — see §4. |

Every automated gate passes:

```
client   55 suites / 605 passed, 1 skipped
relay    11 suites / 102 passed
tsc --noEmit                     clean
gitleaks, full 20-commit history no leaks
release config check             19/22, 0 failed, 3 pending owner action
```

## 1. Relay — verified deployable, end to end

Not merely "tests pass": the server was booted with the same environment the container sets and
probed live.

```
boot with RELAY_PORT/POOL_PORT/RELAY_DATA_DIR/ISSUER_*_KEY_PATH   → starts clean
GET /health                                    → 200 {"status":"ok","version":"2.0"}
GET /stats            (no token)               → 401
GET /stats            (bad token)              → 403
Access-Control-Allow-Origin on /stats          → absent
state written to RELAY_DATA_DIR, not the repo  → confirmed, tree stayed clean
```

That exercises the audit's H4 fix at runtime, not just in a unit test. Container packaging is
guarded separately by `relay-server/deploy-image.test.js`, which asserts every module-scope
`require()` in `server.js` resolves to a path the Dockerfile actually COPYs — the static equivalent
of a boot test, and the exact defect that shipped undetected in the sibling repo.

**Not verified here:** an actual `docker build`/`docker run`. Docker is not installed on this
machine. Run `docker compose up -d` once and confirm `/health`; the CI workflow now does this on
every push (`.github/workflows/ci.yml`, "Smoke test — the built image actually boots").

**Before exposing it:** terminate TLS in front of it (`docs/self-host-security.md`), and set
`ASSISTANT_REDIRECT_URIS` if voice-assistant linking is ever enabled — the OAuth allowlist is
fail-closed, so an unset value refuses every client, which is the safe default.

## 2. Android — ready

The release build was run here and produced a real artifact.

```
./gradlew assembleRelease   → BUILD SUCCESSFUL, 8m57s, 724 tasks
app-release.apk             → versionCode 31, versionName 1.31.0, targetSdk 36
```

The shipped cleartext policy was verified by decoding the resource **out of the built APK**, not by
reading the source: `base-config cleartextTrafficPermitted=false`, cleartext permitted only for
`localhost`, `127.0.0.1`, `10.0.2.2`, `10.0.3.2`, `home.arpa`, and the three public endpoints
explicitly denied.

Note the APK built here is **debug-signed** (the release signing config falls back to the debug
keystore when no upload key is configured) and is therefore not submittable. Build through EAS with
the real upload key.

## 3. Owner actions — 3 outstanding

`cd GroceryApp && npm run check:release` is the machine-checkable form; it runs in CI on every push
and fails only on regression, reporting these as PENDING.

**a. Initialise the EAS remote version counter — before the next production build.**
`appVersionSource` is `remote` with `autoIncrement: true`. EAS seeds the counter from the local
config, and `app.json` still carries `versionCode: 31` / `buildNumber: "31"`, so a fresh project
lands on 32. That cannot be confirmed from here — reading the counter needs an authenticated Expo
session for owner `shiftlogichq`. Play rejects any versionCode ≤ 31.

```bash
cd GroceryApp
npx eas-cli build:version:get --platform android    # must be >= 31
npx eas-cli build:version:set --platform android    # only if it reads lower
npx eas-cli build:version:get --platform ios
```

A guard now pins the seed: deleting `versionCode` from `app.json` fails the release check, because
that is what would silently make EAS start from 1.

**b. Provide the Play service-account key.** `eas.json` points at
`./credentials/play-service-account.json`. Now gitignored (`credentials/`,
`*play-service-account*.json`) — that gap was found and closed here. Provision it locally; never
commit it.

**c. Fill in the Apple IDs.** `eas.json` `submit.production.ios` still has literal
`REPLACE_WITH_APP_STORE_CONNECT_APP_ID` / `REPLACE_WITH_APPLE_TEAM_ID`. These are account facts
recorded nowhere in the repo; inventing plausible values would be worse than placeholders that fail
loudly at `eas submit`.

## 4. iOS — what is proven, and what is not

**Proven:** the Release build compiles (`** BUILD SUCCEEDED **`), the app installs, launches, stays
alive, and renders its own React Native UI. Two ABI breaks that made launch impossible are fixed and
were verified by a symbol sweep over all 15 Mach-Os on both the arm64 and x86_64 slices — zero
unresolved symbols in every namespace.

**Not proven: that the app reaches its main screen.** It stops on its own "PantryRun couldn't start"
error boundary. The cause is understood and is not a defect in the app:

- `expo-secure-store` calls Keychain during `App.tsx` init.
- Keychain returns `-34018 errSecMissingEntitlement`, because a build made with
  `CODE_SIGNING_ALLOWED=NO` carries no `application-identifier`.
- `App.tsx` treats that as fatal.

Three routes were tried and all fail for environmental reasons, not code reasons: enabling code
signing wedges `xcodebuild` (this machine has **zero valid signing identities**); ad-hoc re-signing
with a synthetic `application-identifier` makes SpringBoard refuse the app outright
(`SBMainWorkspace` denied); and there is no provisioning profile to sign against.

**To close it,** run either of these — both take minutes and both produce an entitled build:

```bash
cd GroceryApp && npx eas-cli build --profile development --platform ios
# or: open ios/PantryRun.xcworkspace in Xcode, set your Apple ID as the team, Run
```

Expected result: init completes and the app reaches the list UI. If it still fails, capture the
error behind "Show details" — but every non-signing dependency of that path is already verified.

## 5. Local build note (not a repo change)

iOS builds from this checkout need:

```bash
APPLE="GroceryApp/node_modules/expo-modules-jsi/apple"
mkdir -p ~/Library/Developer/Xcode/DerivedData/ExpoModulesJSI
ln -sfn ~/Library/Developer/Xcode/DerivedData/ExpoModulesJSI "$APPLE/.DerivedData"
```

The repo lives under iCloud-synced `~/Documents`; the fileprovider stamps `com.apple.FinderInfo` on
`.framework` directories, and the ExpoModulesJSI build phase runs a nested `xcodebuild` under
`env -i` that codesigns and dies with "resource fork, Finder information, or similar detritus not
allowed". Proven with a control experiment: identical script and inputs failed from `~/Documents`
(exit 65) and succeeded from `/tmp` (exit 0). **Any `npm install` deletes the symlink.** EAS Build is
unaffected — it does not run inside iCloud.

## 6. Deliberately deferred

- **`@sentry/react-native` 8.14.0** and **`react-native-get-random-values` 2.0.0** — expo-doctor
  wants both *downgraded*. One sits in the crypto path. A product decision, not cleanup.
- **Voice-assistant / OAuth pairing (H5)** — hardened (CSPRNG codes at 39.3 bits, constant-time
  lookup, expiry, bounded attempts, fail-closed redirect allowlist) but the feature is default-off
  and its webhook is undeployed. Do not enable without the disclosure work in `docs/MONETIZATION.md`.
- **M5 end state** — Android now denies cleartext by default. LAN self-hosters on a bare
  `ws://192.168.x.x` must move to a `home.arpa` name or `wss://`; `docs/self-host-security.md` is
  migrated. Call this out in release notes.

## 7. Recommended sequence

1. Verify the EAS version counter (§3a).
2. `eas build --profile production --platform android` → promote in the Play console.
3. Provide the Play key (§3b) and the Apple IDs (§3c).
4. `eas build --profile development --platform ios`, confirm the app reaches its UI (§4).
5. `eas build --profile production --platform ios` → submit.
6. Deploy the relay behind TLS; confirm `/health`.
