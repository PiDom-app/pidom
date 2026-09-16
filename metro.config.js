const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');
const {
  withTransformersReactNativeMetro,
} = require('@automatalabs/react-native-transformers/metro');

/**
 * `@huggingface/transformers` ships a web bundle that imports `onnxruntime-web`
 * and `onnxruntime-node`, neither of which exists on a phone. The helper
 * aliases both at `onnxruntime-react-native` and registers `onnx` and `ort` as
 * asset extensions.
 *
 * Only the tokenizer and the session wrapper are actually used — see
 * `src/features/intelligence/engine/onnx-engine.ts` — but the aliasing has to
 * be global, because the import graph is the library's rather than ours.
 */
const config = withTransformersReactNativeMetro(getDefaultConfig(__dirname));

module.exports = withNativewind(config, { inlineRem: 16 });
