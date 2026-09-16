module.exports = function (api) {
  api.cache(true);

  return {
    // babel-preset-expo resolves tsconfig "paths" (@/* -> ./src/* then ./*) and
    // auto-adds react-native-worklets/plugin for Reanimated 4, so neither
    // babel-plugin-module-resolver nor an explicit worklets plugin is needed.
    //
    // `unstable_transformImportMeta` is for `@huggingface/transformers`, whose
    // published web bundle uses `import.meta` — which Hermes does not have. It
    // is the tokenizer half of the on-device search model; see
    // `src/features/intelligence/engine/onnx-engine.ts`.
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }], 'nativewind/babel'],
  };
};
