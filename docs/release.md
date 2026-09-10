# Android Releases

Pidom is distributed as a signed Android APK from GitHub Releases. Install the
first APK manually; compatible JavaScript and asset changes arrive through EAS
Update on a later launch. A native dependency, permission, Expo configuration,
or renderer change needs a new APK.

## One-time production setup

- EAS owns the Android signing keystore for `com.pidom.app` add it to the
  Android OAuth client in Firebase or Google Cloud before the first release.
- EAS production contains the public app identifiers and the secret
  `GOOGLE_SERVICES_JSON` file. The app config reads that file only while EAS
  builds; local builds use the ignored `google-services.json` fallback.
- The public update certificate is `certs/eas-update.pem`. Its private key is
  the GitHub `production` environment secret `EAS_UPDATE_PRIVATE_KEY` and must
  never be committed or copied into an Expo environment variable.
- GitHub `production` also needs `EXPO_TOKEN` from a dedicated Expo robot user
  and a `CONVEX_DEPLOY_KEY` scoped to the production deployment with only the
  `deployment:deploy` permission.

## Release flow

A successful push to `main` deploys Convex, creates a frozen-credential EAS APK
build, uploads the APK and SHA-256 checksum to a GitHub Release, and publishes a
signed update to the `production` channel. Pull requests run quality checks only.
