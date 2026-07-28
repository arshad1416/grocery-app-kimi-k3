module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // WatermelonDB requires decorators. Other class-property transforms
      // are already included in babel-preset-expo — adding them again causes
      // double-transformation and conflicts with Hermes at runtime.
    ],
  };
};
