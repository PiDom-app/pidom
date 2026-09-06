# Setup

## Running it

Native Google Sign-In needs custom native code, so **Expo Go will not work**.
You need a development build.

```bash
npm install

npx convex dev                       # creates the deployment, writes convex/_generated
npx convex env set GOOGLE_WEB_CLIENT_ID <id>.apps.googleusercontent.com

# Cloudflare R2, for syncing documents between devices
npx convex env set R2_BUCKET <bucket>
npx convex env set R2_ENDPOINT <endpoint>
npx convex env set R2_ACCESS_KEY_ID <id>
npx convex env set R2_SECRET_ACCESS_KEY <secret>

cp .env.example .env.local           # fill in all three values

npx expo prebuild --clean            # the PDF config plugins are new
npx expo run:android                 # or run:ios
```

`react-native-pdf` and `react-native-blob-util` need
`@config-plugins/react-native-pdf` and `@config-plugins/react-native-blob-util`
in `app.json` to link at all. Both are there now. They were not before, which
would have shown up as a missing native module the first time anything imported
the viewer.

`convex/_generated/` is written by `npx convex dev`. Until it has run once,
`npm run typecheck` cannot resolve `@convex/_generated/api` — that is expected
on a fresh clone, not a broken checkout.

### Cloudflare setup

Syncing needs an R2 bucket. Importing, reading, covers, contents and everything
else local work without one — two things are dead until it is set up: "Available
on all devices", and searching inside documents. That second one follows from
the first: extraction reads the copy in the bucket, because that copy is the only
one the server can see.

- Create a Cloudflare account and an R2 bucket.
- One bucket serves both deployments. That is safe because the orphan sweep
  checks the owner in the key against this deployment's `users` table before it
  considers anything an orphan — see `docs/security.md`. A separate bucket per
  deployment is still the tidier arrangement if you want one.
- Give the bucket a CORS policy. **Only a web build needs one** — React Native's
  `fetch` is not a browser and does not enforce CORS, so on Android and iOS the
  upload works without any policy at all. It is `web.output: 'single'` that
  makes this matter, and the origin is the Expo dev server:

  ```json
  [
    {
      "AllowedOrigins": ["http://localhost:8081"],
      "AllowedMethods": ["GET", "PUT"],
      "AllowedHeaders": ["content-type"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

  `PUT` because an S3 signed upload URL is a PUT; `GET` for the signed
  download. `content-type` is the only header `transfer.ts` sends, and there is
  no `ExposeHeaders` because nothing reads anything off the response — the size,
  type and digest are read back from R2 server-side in `attachUpload` instead.
  Add the deployed web origin to `AllowedOrigins` when there is one.
- **Manage R2 API Tokens → Create API Token**, permissions **Object Read &
  Write**, scoped to that bucket. It hands back the four values above alongside
  the bucket name.

R2's free tier is 10 GB of storage, 1M class-A and 10M class-B operations a
month, and no egress charge. At the 100 MB per-document cap that is around a
hundred synced documents.

### Opening PDFs from other apps

`app.json` registers Pidom as a PDF handler on both platforms, which puts it in
Android's "Open with" list and iOS's "Open in" list. Both are native manifest
entries, so they only exist after a rebuild:

```bash
npx expo prebuild --clean
npx expo run:android      # or run:ios
```

Android's share sheet is deliberately not covered — see
[architecture.md](architecture.md#opening-a-pdf-from-another-app) for why.

### Google setup

In Google Cloud (or Firebase) you need three OAuth clients: **Web**, **Android**,
and **iOS**.

- The **Web** client ID is what goes in both `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
  and the Convex `GOOGLE_WEB_CLIENT_ID`. They must match exactly.
- The **iOS** client ID goes in `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. It is only
  required when building for iOS — `env.ts` asks for it on that platform alone,
  so Android works without one.
- The **Android** client is never named in code. Nothing passes its id anywhere;
  it exists so Google Play Services can check the app's signature. What it needs
  is the SHA-1 of every key that will sign the app: the local debug keystore,
  the EAS build key, and the Play upload key. A missing fingerprint shows up as
  `DEVELOPER_ERROR` at sign-in and nothing more specific.

**Do not create the Android client by hand.** Adding a SHA-1 under Firebase →
Project settings → Your apps creates it for you, and creating a second one in
Google Cloud then fails with *"the Android package name and fingerprint are
already in use"* — Google requires every (package name, SHA-1) pair to be unique
across all Firebase and Cloud projects, so that error means the client already
exists. Re-download `google-services.json` and check for an entry with
`"client_type": 1`; if it is there, the work is done. Getting the debug SHA-1:

**Take the fingerprint from the keystore that signs the build, which is not the
one in your home directory.** `android/app/build.gradle` sets
`storeFile file('debug.keystore')`, resolved relative to `android/app` — so a
debug build is signed with `android/app/debug.keystore`, generated by
`expo prebuild`, and *not* with `~/.android/debug.keystore`. They are different
keys with different fingerprints, and registering the wrong one produces
`DEVELOPER_ERROR` with everything else correct.

```bash
keytool -list -v -keystore android/app/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1
```

`/android` is gitignored and regenerated, so re-check this after any
`prebuild --clean`. The authoritative answer is the APK itself:

```bash
apksigner verify --print-certs android/app/build/outputs/apk/debug/app-debug.apk
```

Registering more than one fingerprint is fine and expected — the debug key, the
EAS build key and the Play upload key all belong there.

**The google-signin config plugin has two modes, and the wrong one is silent.**
Given options (`["@react-native-google-signin/google-signin", { iosUrlScheme }]`)
it appends an iOS URL scheme and does *nothing whatsoever for Android* — no
Gradle plugin, and `google-services.json` never reaches the build. Given no
options it applies `withClassPath`, `withApplyPlugin` and `withGoogleServicesFile`
on Android, which is the mode to use when there is a Firebase config file. That
is what `app.json` does now, alongside `android.googleServicesFile`. The iOS half
of that mode returns early when `ios.googleServicesFile` is absent, so it is safe
to use with no `GoogleService-Info.plist`.

Note that this library takes `webClientId` as a plain string — there is no
`autoDetect` value, whatever you may read about it. That belongs to the separate
Nitro rewrite, not to this package.

### Android "Bold text" and clipped labels

If every label on the device is missing its last word — `Sign out` rendered as
`Sign`, an email without its `.com` — the cause is Settings → Accessibility →
Display size and text → **Bold text**. Android 12 added
`Configuration.fontWeightAdjustment`, which that toggle sets to 300 and the
system adds to every font weight at *render* time. React Native measures text
with the unadjusted typeface, so each string is laid out narrower than it draws
and the overflow is clipped, silently and with no ellipsis. It is an old React
Native bug rather than anything in this app:
[facebook/react-native#21729](https://github.com/react/react-native/issues/21729).

Confirm it in one command before assuming a layout bug:

```bash
adb shell settings get secure font_weight_adjustment   # 300 = Bold text is on
```

`plugins/with-text-measurement-fix.js` neutralises the adjustment for this app.
The trade-off is stated in the plugin: somebody who turned Bold text on will not
get bolder text here, which is a real cost — and still better than losing the end
of every sentence, since a reader who cannot read thin text cannot read a
truncated one either. The app's own `font-semibold` and `font-bold` are
unaffected; only the system-wide bump is dropped. Remove the plugin from
`app.json` and re-run `npx expo prebuild` to get the system behaviour back.

## Scripts

| | |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run android` / `ios` / `web` | Platform targets |
| `npm run convex` | Convex dev server and codegen watcher |
| `npm run typecheck` | `tsc --noEmit`, incremental |
| `npm run lint` | `expo lint` |

A clean `typecheck` runs in about 8 seconds cold and 3 incremental. It used to
take 75, and the difference is `src/components/ui/styled-shim.ts` — read it
before touching the vendored components.

The short version: NativeWind re-exports `styled` from `react-native-css`, whose
signature constrains its mapping argument to `DotNotation<ComponentProps<C>>` —
a union of every dotted path through the component's props, ten levels deep.
Over a React Native view that union is combinatorial, and over a Reanimated
animated component it overflows the checker outright (TS2589, TS2590). Measured
here it cost 9.36M type instantiations, 71 of 75 seconds, and 1.4GB. All of it
computing a constraint that gets discarded, since the real `styled` returns
`any`. Routing the call sites — fourteen of them, across nine components —
through a locally typed `styled` brought that to 120k instantiations and a few
seconds of check time.

If a regenerated component starts importing `styled` from `'nativewind'` again,
the slow path comes back with it.

`expo lint` has no ESLint config yet; the first run offers to create one.

## Known rough edge

Google ID tokens last one hour, and Convex re-authenticates its socket on its
own schedule, so the token has to refresh unattended. On iOS the library handles
that transparently. On Android it has a
[history](https://github.com/react-native-google-signin/google-signin/issues/926)
of returning the cached, expired token instead.

`session-provider.tsx` clears the native cache before every refresh, checks the
result rather than trusting it, and ends the session if a renewal comes back
already expired — so a failed refresh routes to the sign-in screen instead of
leaving the app hung against a backend that will not answer. Worth watching
during long sessions on Android.

If it proves unreliable in the field, the fix is to exchange the Google token
once for a backend-issued session. `SessionProvider` is the boundary that makes
that a single-file change.
