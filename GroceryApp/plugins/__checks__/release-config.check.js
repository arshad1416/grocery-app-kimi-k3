#!/usr/bin/env node
/**
 * Release-configuration regression check (audit findings M5, M7, M8, L11, L12).
 *
 * Run: node plugins/__checks__/release-config.check.js
 *
 * NOT WIRED UP YET — this needs two lines in files outside this work item's owned
 * paths, and until they land nothing runs this and nothing goes red on a revert:
 *
 *   GroceryApp/package.json  scripts:
 *     "check:release": "node plugins/__checks__/release-config.check.js"
 *   .github/workflows/ci.yml  client job, alongside the jest step:
 *     - run: npm run check:release
 *
 * Deliberately NOT a jest test and deliberately not wired in via jest.config.js:
 * that config pins `roots: ['<rootDir>/__tests__']` AND `testMatch: ['**\/*.test.ts']`,
 * so a .js assert script needs both widened, and this is a config-tree gate rather
 * than a unit test — the npm script is the smaller, more honest hook.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const checks = [];
const check = (name, fn) => checks.push([name, fn, false]);

/**
 * A finding that is deliberately NOT closed because closing it needs a value or a
 * decision only the repo owner can supply. It asserts the *closed* state, so it
 * turns green by itself the day the owner acts — but a failure prints as
 * PENDING-OWNER and does not fail the run, so the other checks stay a usable gate.
 * Never demote a check here to make it pass; the point is that it stays visible.
 */
const pending = (name, fn) => checks.push([name, fn, true]);

// ── Both config files must be strict, parseable JSON ────────────────────────
check('app.json parses as strict JSON', () => readJson('app.json'));
check('eas.json parses as strict JSON', () => readJson('eas.json'));

// ── M8: the app.json cleartext key is an inert no-op ────────────────────────
// Empirically settled: `usesCleartextTraffic` exists nowhere in @expo/config-types'
// schema and is never read from the config by @expo/config-plugins — it appears only
// as a TypeScript type describing an AndroidManifest XML attribute. Carrying it in
// app.json states an intent nothing enforces, contradicting the manifest that does.
check('M8: app.json carries no inert usesCleartextTraffic key', () => {
  const android = readJson('app.json').expo.android;
  assert.strictEqual(
    android.usesCleartextTraffic,
    undefined,
    'app.json android.usesCleartextTraffic is a no-op key; intent belongs in the config plugin'
  );
  assert.strictEqual(android._usesCleartextTrafficNote, undefined);
});

check('M8: a network-security config plugin is registered in app.json', () => {
  const plugins = readJson('app.json').expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(
    plugins.includes('./plugins/withNetworkSecurityConfig.js'),
    'prebuild must reproduce the committed manifest, not silently drop the cleartext scoping'
  );
});

check('M8: committed res/xml matches the plugin constant byte for byte', () => {
  const { NETWORK_SECURITY_CONFIG_XML, RES_PATH } = require(
    path.join(root, 'plugins/withNetworkSecurityConfig.js')
  );
  assert.strictEqual(
    read(path.join('android', RES_PATH)),
    NETWORK_SECURITY_CONFIG_XML,
    'the committed resource has drifted from the plugin that regenerates it on prebuild'
  );
});

check('M8: the config plugin produces the committed manifest attribute', () => {
  const withNsc = require(path.join(root, 'plugins/withNetworkSecurityConfig.js'));
  assert.strictEqual(typeof withNsc, 'function');
  // Drive the manifest mod the way expo-config-plugins does and confirm it sets the
  // same attribute pair the committed AndroidManifest.xml has.
  const app = { $: { 'android:name': '.MainApplication' } };
  const config = { modResults: { manifest: { application: [app] } } };
  withNsc.setNetworkSecurityConfig(config.modResults);
  assert.strictEqual(app.$['android:networkSecurityConfig'], '@xml/network_security_config');
  assert.strictEqual(app.$['android:usesCleartextTraffic'], undefined);
});

// ── M5: cleartext must be scoped by a network security config ───────────────
check('M5: AndroidManifest no longer enables cleartext app-wide', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.ok(
    !/android:usesCleartextTraffic="true"/.test(manifest),
    'app-wide cleartext is still enabled in the release manifest'
  );
  assert.ok(
    /android:networkSecurityConfig="@xml\/network_security_config"/.test(manifest),
    'manifest does not reference a network security config'
  );
});

check('M5: public API endpoints are pinned to HTTPS', () => {
  const nsc = read('android/app/src/main/res/xml/network_security_config.xml');
  assert.ok(
    /<domain-config[^>]*cleartextTrafficPermitted="false"/.test(nsc),
    'no domain-config denies cleartext; the app gained nothing over the bare attribute'
  );
  for (const host of ['groceryapp.app', 'api.nal.usda.gov', 'openfoodfacts.org']) {
    assert.ok(nsc.includes(`>${host}<`), `public endpoint not pinned to HTTPS: ${host}`);
  }
});

check('M5: iOS keeps the ATS scoping the Android config is meant to mirror', () => {
  const ats = readJson('app.json').expo.ios.infoPlist.NSAppTransportSecurity;
  assert.strictEqual(ats.NSAllowsArbitraryLoads, false, 'iOS ATS must deny arbitrary loads');
  assert.strictEqual(ats.NSAllowsLocalNetworking, true, 'iOS must still permit the LAN relay');
});

pending('M5: Android denies cleartext by default, mirroring iOS ATS', () => {
  // The remaining half of M5. Deliberately red until the owner signs off, because
  // closing it is a breaking change, not a config tweak: docs/self-host-security.md
  // tells self-hosters to connect via bare LAN IP, Android's NSC grammar has no
  // CIDR to exempt RFC1918 with, and RN's WebSocket honours NetworkSecurityPolicy
  // via OkHttp. Land it together with a docs change moving self-hosters to a
  // router-resolvable hostname or wss://; see the comment in the XML itself.
  const nsc = read('android/app/src/main/res/xml/network_security_config.xml');
  assert.ok(
    /<base-config[^>]*cleartextTrafficPermitted="false"/.test(nsc),
    'base-config still permits cleartext app-wide; only the public endpoints are pinned'
  );
});

// ── M7: repeated iOS submissions must get distinct build numbers ────────────
check('M7: production builds auto-increment the build number', () => {
  const eas = readJson('eas.json');
  assert.notStrictEqual(
    eas.build.production.autoIncrement,
    false,
    'autoIncrement:false makes a second iOS submission collide with the first'
  );
  assert.ok(eas.build.production.autoIncrement, 'autoIncrement must be enabled for production');
  // autoIncrement alone is not enough on this project. With appVersionSource
  // "local" and committed native trees, EAS bumps Info.plist/build.gradle inside
  // the build container and the change is discarded unless someone commits it —
  // so the next CI build reuses the same number and the submission still collides.
  // "remote" keeps the counter on EAS servers, which is what makes it monotonic.
  assert.strictEqual(
    eas.cli.appVersionSource,
    'remote',
    'appVersionSource must be "remote" for autoIncrement to survive CI builds'
  );
});

check('M7: committed iOS build number is not stale against Android', () => {
  // The native trees are committed and not easignored, so EAS builds from them:
  // Info.plist CFBundleVersion is the real iOS build number, app.json ios.buildNumber
  // is inert on this path (same failure mode as M8).
  const infoPlist = read('ios/PantryRun/Info.plist');
  const bundleVersion = /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(infoPlist)[1];
  const versionCode = /versionCode\s+(\d+)/.exec(read('android/app/build.gradle'))[1];
  assert.strictEqual(
    bundleVersion,
    versionCode,
    `iOS CFBundleVersion ${bundleVersion} drifted from Android versionCode ${versionCode}`
  );
});

// ── L11: the iOS submit profile must be usable ──────────────────────────────
check('L11: eas.json has an iOS submit profile with both required keys', () => {
  const ios = readJson('eas.json').submit.production.ios;
  assert.ok(ios, 'submit.production has no ios block');
  assert.ok(ios.ascAppId, 'submit.production.ios.ascAppId is missing');
  assert.ok(ios.appleTeamId, 'submit.production.ios.appleTeamId is missing');
});

check('L11: eas.json has an Android submit profile with a key path and a track', () => {
  // `eas submit --platform android` needs both, and an absent android block fails
  // just as hard as the iOS placeholders do — it was simply invisible before.
  const android = readJson('eas.json').submit.production.android;
  assert.ok(android, 'submit.production has no android block');
  assert.ok(
    android.serviceAccountKeyPath,
    'submit.production.android.serviceAccountKeyPath is missing'
  );
  assert.ok(
    ['internal', 'alpha', 'beta', 'production'].includes(android.track),
    `submit.production.android.track must be an explicit Play track, got ${android.track}`
  );
});

pending('L11: the Play service-account key path is gitignored', () => {
  // The key is a Google service-account JSON with upload rights to the Play
  // listing; it must never be committed. Neither .gitignore is inside this work
  // item's owned paths, so the rule cannot be added from here — hence pending.
  // Substring match on the file text, not `git check-ignore`: no git commands.
  const dir = `${path.dirname(readJson('eas.json').submit.production.android.serviceAccountKeyPath)}/`
    .replace(/^\.\//, '');
  const ignores = [read('.gitignore'), read('../.gitignore')].join('\n');
  assert.ok(
    ignores.split('\n').some((line) => line.trim().replace(/^GroceryApp\//, '') === dir),
    `no .gitignore rule covers ${dir}; the Play service-account key can be committed by accident`
  );
});

pending('L11: the Play service-account key is actually present', () => {
  // Shape-only checks are how L11 stayed invisible the first time: a path that
  // points at nothing passes every structural assertion while
  // `eas submit --platform android` still fails. This is expected to print on a
  // fresh checkout — the key is provisioned, never committed — but it belongs in
  // the outstanding list so "0 failed" is never read as "ready to submit".
  const p = readJson('eas.json').submit.production.android.serviceAccountKeyPath;
  assert.ok(
    fs.existsSync(path.join(root, p)),
    `Play service-account JSON not present at ${p}; provision it before submitting`
  );
});

pending('L11: the iOS submit profile carries real IDs, not placeholders', () => {
  // The shape is right but the values are not fillable from here — an App Store
  // Connect app ID and an Apple team ID are account-specific and must not be
  // invented. `eas submit --platform ios --profile production` fails until the
  // owner replaces both, so this stays visibly pending rather than green.
  const ios = readJson('eas.json').submit.production.ios;
  assert.ok(!/^REPLACE_WITH_/.test(ios.ascAppId), 'ascAppId is still the placeholder');
  assert.ok(!/^REPLACE_WITH_/.test(ios.appleTeamId), 'appleTeamId is still the placeholder');
});

// ── L12: release pushes must target the production APNs environment ─────────
check('L12: release entitlements use the production APNs environment', () => {
  const ent = read('ios/PantryRun/PantryRun.entitlements');
  // Tolerate an explanatory <!-- --> comment between the key and its value.
  const after = ent.slice(ent.indexOf('<key>aps-environment</key>'));
  const apsEnv = /<string>([^<]*)<\/string>/.exec(after)[1];
  assert.strictEqual(
    apsEnv,
    'production',
    'a release build with aps-environment=development registers against the APNs sandbox'
  );
});

check('L12: Debug signs against a separate entitlements file using the APNs sandbox', () => {
  // aps-environment must differ per configuration. A Development provisioning
  // profile — which `eas build --profile development` and `expo run:ios` both
  // use — carries aps-environment=development, so pointing Debug at the release
  // entitlements makes the entitlement disagree with the profile and the build
  // fails to sign. One shared file cannot express both; hence two.
  const pbx = read('ios/PantryRun.xcodeproj/project.pbxproj');
  // Pair each XCBuildConfiguration that sets CODE_SIGN_ENTITLEMENTS with its own
  // trailing `name = X;`. Keyed off structure, not UUIDs, so it survives an Xcode
  // rewrite — and it skips the project-level Debug/Release blocks, which set no
  // entitlements at all.
  const paths = {};
  const re = /CODE_SIGN_ENTITLEMENTS = ([^;]+);[\s\S]*?\n\t\t\tname = (\w+);/g;
  for (let m; (m = re.exec(pbx)); ) paths[m[2]] = m[1].trim();
  assert.ok(paths.Debug && paths.Release, 'no per-configuration CODE_SIGN_ENTITLEMENTS found');
  assert.notStrictEqual(
    paths.Debug,
    paths.Release,
    `Debug and Release share ${paths.Release}; flipping it to production breaks dev signing`
  );
  const debugEnt = read(path.join('ios', paths.Debug));
  const after = debugEnt.slice(debugEnt.indexOf('<key>aps-environment</key>'));
  assert.strictEqual(
    /<string>([^<]*)<\/string>/.exec(after)[1],
    'development',
    'the Debug entitlements must keep the APNs sandbox environment'
  );
});

let failed = 0;
const outstanding = [];
for (const [name, fn, isPending] of checks) {
  try {
    fn();
    console.log(`  ok      ${name}`);
  } catch (err) {
    if (isPending) {
      outstanding.push(`${name} — ${err.message}`);
      console.log(`  PENDING ${name}\n            owner action: ${err.message}`);
    } else {
      failed++;
      console.log(`  FAIL    ${name}\n            ${err.message}`);
    }
  }
}
console.log(
  `\n${checks.length - failed - outstanding.length}/${checks.length} passed, ` +
    `${outstanding.length} pending owner action, ${failed} failed`
);
// A green run means "no regressions", NOT "ready to ship". Say so loudly: the
// pending items are release *preconditions*, and a summary that only counts
// passes reads as submittable when neither store submission would actually work.
if (outstanding.length) {
  console.log(`\nNOT SUBMITTABLE: ${outstanding.length} owner action(s) outstanding`);
  outstanding.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
}
// Exit code tracks regressions only — owner preconditions must not wedge CI.
process.exit(failed ? 1 : 0);
