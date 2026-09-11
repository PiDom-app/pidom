# Android Releases

Pidom is distributed as a signed Android APK from GitHub Releases. Install the
first APK manually; compatible JavaScript and asset changes arrive through EAS
Update on a later launch. A native dependency, permission, Expo configuration,
or renderer change needs a new APK.

The update runtime follows the app version. Before merging any native change,
increment `version` in `app.config.ts`, then let the `main` release build a new
APK. JavaScript-only changes retain the current version and publish to the
existing production runtime. This is intentional: Expo SDK 57 has an upstream
fingerprint-runtime mismatch for Continuous Native Generation projects after
EAS creates the ignored `/android` directory, so `appVersion` is the stable
runtime boundary for this project.

The project uses standard EAS Update on Expo's Free plan. Updates travel over
TLS but are not end-to-end code-signed. A code-signed update requires an EAS
Production or Enterprise subscription. The Android APK itself remains signed
with the EAS-managed Android keystore.

Production APK builds upload JavaScript source maps for EAS Observe error
symbolication. Expo strips embedded source content before storing those maps;
the release build still carries file names and position mappings so production
JavaScript stack traces can point back to source locations.

## One-time production setup

- EAS owns the Android signing keystore for `com.pidom.app` add it to the
  Android OAuth client in Firebase or Google Cloud before the first release.
- EAS production contains the public app identifiers and the secret
  `GOOGLE_SERVICES_JSON` file. The app config reads that file only while EAS
  builds; local builds use the ignored `google-services.json` fallback.
- GitHub `production` also needs `EXPO_TOKEN` from a dedicated Expo robot user
  and a `CONVEX_DEPLOY_KEY` scoped to the production deployment with only the
  `deployment:deploy` permission.

## Release flow

A successful push to `main` deploys Convex, creates a frozen-credential EAS APK
build, uploads the APK and SHA-256 checksum to a GitHub Release, and publishes a
compatible update to the `production` channel. Pull requests run quality checks
only. The public GitHub Release body includes the generated changelog, the EAS
build ID, the commit, checksum verification instructions, the update/runtime
boundary, and the active Observe/security notes for that APK.
