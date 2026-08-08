const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

/**
 * Scopes Android cleartext traffic to the self-hosted relay (audit M5, M8).
 *
 * Why a config plugin at all: `android.usesCleartextTraffic` in app.json is an
 * inert key. It is absent from @expo/config-types' schema and nothing in
 * @expo/config-plugins ever reads it off the config — it appears only as a
 * TypeScript type describing an AndroidManifest XML attribute. The cleartext
 * setting shipped purely because the generated android/ tree is committed, so
 * app.json and the manifest stated the same intent twice, with only one of them
 * load-bearing, and a `prebuild --clean` would have silently dropped it.
 *
 * This plugin is now the single place that intent lives. It writes the resource
 * and points the manifest at it, so a clean prebuild reproduces exactly what is
 * committed under android/ instead of regressing to unscoped cleartext.
 *
 * The scoping rationale — and the RFC1918 limitation of Android's
 * network-security-config grammar — is documented in the XML itself below.
 */

const RES_PATH = "app/src/main/res/xml/network_security_config.xml";

/**
 * Canonical contents of res/xml/network_security_config.xml.
 * The committed copy under android/ is generated from this constant; keep them
 * byte-identical (plugins/__checks__/release-config.check.js asserts it).
 */
const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Cleartext policy for PantryRun (audit M5). This is a PARTIAL fix — the audit's
  end state is described under "still open" below and needs an owner decision.

  This replaces a bare android:usesCleartextTraffic="true" on <application>. The
  attribute was a single global switch with no way to say anything about *which*
  hosts; this file is a reviewable, per-host policy, and it is where the
  remaining tightening goes.

  CLOSED here, at no functional cost: the app's known public endpoints are pinned
  to HTTPS, so none of them can be downgraded to plain HTTP.

  STILL OPEN: base-config permits cleartext to every other host, so this does not
  yet mirror iOS's NSAllowsArbitraryLoads=false. That gap is a *breaking change*
  to close, not an inexpressible one — the distinction matters, so precisely:

    Expressible as <domain> entries: localhost, 127.0.0.1, 10.0.2.2 (the
      Android-emulator alias for the host machine), any DNS name the user's
      router resolves, and the .home.arpa suffix.
    NOT expressible: an RFC1918 *range*. The grammar has no CIDR, and
      includeSubdomains matches a DNS *suffix* while the octet that varies in a
      private IP is the suffix — 192.168.0.0/16 would take 65k entries. This is
      the one case iOS's NSAllowsLocalNetworking covers for free.

    And a bare LAN IP is what this product documents. docs/self-host-security.md
    tells users to "connect via LAN IP ... e.g. http://192.168.1.50:8080" and
    calls it the most secure option; PairingScreen's manual-connection field
    ships the placeholder ws://192.168.1.100. React Native's WebSocket goes
    through OkHttp, which consults
    NetworkSecurityPolicy.isCleartextTrafficPermitted(host), so flipping
    base-config to "false" silently breaks sync for every self-hoster who
    followed those docs — on a version already live in closed testing.

  End state, once the owner signs off: base-config cleartextTrafficPermitted="false"
  plus a permissive domain-config for localhost / 127.0.0.1 / 10.0.2.2 / home.arpa,
  shipped together with a docs change pointing LAN self-hosters at a hostname their
  router's DNS resolves, or at wss://. Not ".local" — Android's OkHttp path does
  not resolve mDNS without NsdManager, so a .local entry would be decorative.
  plugins/__checks__/release-config.check.js reports that flip as PENDING-OWNER
  and turns green when it lands.
-->
<network-security-config>
  <!-- Permissive default, solely so a LAN relay at a bare private IP keeps
       working. Read "STILL OPEN" above before changing this to "false": it is
       the right end state, but it needs the docs migration in the same change. -->
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>

  <!-- Public endpoints the app actually calls: HTTPS only, no downgrade. -->
  <domain-config cleartextTrafficPermitted="false">
    <!-- Invite / applink host and its subdomains. -->
    <domain includeSubdomains="true">groceryapp.app</domain>
    <!-- USDA FoodData Central product lookups. -->
    <domain includeSubdomains="true">api.nal.usda.gov</domain>
    <!-- Open Food Facts product lookups. -->
    <domain includeSubdomains="true">openfoodfacts.org</domain>
  </domain-config>
</network-security-config>
`;

/**
 * Points <application> at the resource and drops the app-wide cleartext switch.
 * Exported so the release-config check can drive it without running a prebuild.
 */
function setNetworkSecurityConfig(androidManifest) {
  const application = androidManifest.manifest.application?.find((a) =>
    a.$?.["android:name"]?.endsWith(".MainApplication")
  );
  if (!application) {
    throw new Error("AndroidManifest.xml is missing the MainApplication element");
  }
  application.$["android:networkSecurityConfig"] = "@xml/network_security_config";
  // The whole point of the resource is that this blanket attribute goes away;
  // leaving it would keep permitting cleartext to every host on API < 24.
  delete application.$["android:usesCleartextTraffic"];
  return androidManifest;
}

function withNetworkSecurityConfig(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = setNetworkSecurityConfig(cfg.modResults);
    return cfg;
  });

  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const dest = path.join(cfg.modRequest.platformProjectRoot, RES_PATH);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, NETWORK_SECURITY_CONFIG_XML);
      return cfg;
    },
  ]);
}

module.exports = withNetworkSecurityConfig;
module.exports.setNetworkSecurityConfig = setNetworkSecurityConfig;
module.exports.NETWORK_SECURITY_CONFIG_XML = NETWORK_SECURITY_CONFIG_XML;
module.exports.RES_PATH = RES_PATH;
