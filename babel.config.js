module.exports = function (api) {
  api.cache(true);

  return {
    // babel-preset-expo resolves tsconfig "paths" (@/* -> ./src/* then ./*) and
    // auto-adds react-native-worklets/plugin for Reanimated 4, so neither
    // babel-plugin-module-resolver nor an explicit worklets plugin is needed.
    presets: [['babel-preset-expo'], 'nativewind/babel'],
  };
};
