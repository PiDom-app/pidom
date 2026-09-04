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
npx convex env set R2_TOKEN <token>

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
- Give the bucket a CORS policy allowing `GET` and `PUT`.
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
- The **iOS** client ID goes in `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and its
  reversed form in `app.json` under the google-signin plugin's `iosUrlScheme`.
- The **Android** client needs the SHA-1 of every key that will sign the app:
  your local debug keystore, the EAS build key, and the Play upload key. A
  missing fingerprint shows up as `DEVELOPER_ERROR` at sign-in and nothing more
  specific.

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
