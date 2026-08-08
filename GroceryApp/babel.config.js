module.exports = function (api) {
  api.cache(true);
  return {
    // `decorators: false` turns OFF babel-preset-expo's own legacy-decorators
    // plugin (configs/expo.js pushes @babel/plugin-proposal-decorators with
    // { legacy: true } unless this option is false). That is deliberate, and
    // it is the enforcement mechanism for an invariant this codebase depends
    // on: there must be ZERO decorator syntax in anything the bundler
    // compiles.
    //
    // Why the invariant exists: under Metro's Hermes transform profile
    // (hermes-stable, every dev build on device) a legacy-decorated class
    // field compiles to an _initializerWarningHelper(...) assignment that
    // throws on EVERY model instantiation — see the header of
    // src/storage/models.ts, which applies the WatermelonDB decorators
    // imperatively for exactly this reason, and records why the usual remedy
    // (global loose class-properties) is not available here: it breaks
    // react-native's own Flow declaration-only statics.
    //
    // Verified against this tree, not assumed:
    //   preset default + ['@babel/plugin-proposal-decorators', {legacy:true}]
    //     in plugins (the previous config)  → compiles, emits the throwing
    //                                          _initializerWarningHelper form
    //   preset default, no plugin entry      → identical broken output; the
    //                                          duplicate plugin was masking
    //                                          that the preset already does it
    //   preset { decorators: false }         → build error, "Support for the
    //                                          experimental syntax 'decorators'
    //                                          isn't currently enabled"
    // Only the last one makes a reintroduced decorator fail loudly at build
    // time instead of silently at runtime on device.
    //
    // Nothing in the bundle needs the transform: src/ contains no decorator
    // syntax, and @nozbe/watermelondb resolves to its compiled CJS entry
    // (main: "./index.js", no react-native/module field), so its raw Flow
    // src/ — which does contain @lazy — is never fed to Babel.
    presets: [['babel-preset-expo', { decorators: false }]],
  };
};
