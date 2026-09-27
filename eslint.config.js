// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // `desktop/` is a separate npm project (Electron Forge + Vite, its own
    // lockfile and CI job). It has no eslint config here; the mobile lint must
    // not walk into it. Its quality gate is `desktop-quality` in CI.
    ignores: ['dist/*', 'desktop/**'],
  },
  {
    rules: {
      // These hooks coordinate native I/O and Reanimated shared values; the
      // app intentionally updates state/refs at these synchronization points.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
