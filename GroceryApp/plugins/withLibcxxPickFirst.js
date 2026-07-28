const { withGradleProperties } = require("expo/config-plugins");

/**
 * Adds android.packagingOptions.pickFirsts for libc++_shared.so
 * to avoid duplicate .so errors when multiple native libs bundle it.
 */
function withLibcxxPickFirst(config) {
  return withGradleProperties(config, (cfg) => {
    const key = "android.packagingOptions.pickFirsts";
    const val = "**/libc++_shared.so";
    const existing = cfg.modResults.find((r) => r.key === key);
    if (!existing) {
      cfg.modResults.push({ type: "property", key, value: val });
    }
    return cfg;
  });
}

module.exports = withLibcxxPickFirst;
