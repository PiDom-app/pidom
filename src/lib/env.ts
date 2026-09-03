/**
 * Validated access to the `EXPO_PUBLIC_*` variables.
 *
 * These are inlined into the bundle at build time, so they are readable by
 * anyone who unpacks the app. That is fine for what lives here — a Convex
 * deployment URL and OAuth client IDs are public identifiers, not secrets. The
 * Google *client secret* is not among them and must never be, which is part of
 * why sign-in uses the native ID token flow rather than an authorization-code
 * exchange the app would have to hold a secret for.
 *
 * Reading them through this module rather than touching `process.env` inline
 * turns a missing variable into one clear error at startup, instead of an
 * opaque websocket failure or a `DEVELOPER_ERROR` from Google several screens
 * later.
 */
import { Platform } from 'react-native';

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${name} is missing. Copy .env.example to .env.local, fill it in, and restart ` +
        'the bundler with `npx expo start --clear` — Expo inlines EXPO_PUBLIC_* at ' +
        'build time, so a running bundler will not pick up the change.',
    );
  }
  return value;
}

export const env = {
  /** Convex deployment URL, e.g. `https://acme-cat-123.convex.cloud`. */
  convexUrl: required('EXPO_PUBLIC_CONVEX_URL', process.env.EXPO_PUBLIC_CONVEX_URL),

  /**
   * The *web* OAuth client ID, on both platforms.
   *
   * `@react-native-google-signin` uses it as the audience of the ID token it
   * returns, which is what `convex/auth.config.ts` pins `applicationID` to. The
   * two must be the same string or every token is rejected as wrong-audience.
   */
  googleWebClientId: required(
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  ),

  /**
   * The iOS OAuth client ID. Required on iOS, unused elsewhere, so it is only
   * demanded on the platform that needs it — an Android-only contributor should
   * not be blocked from running the app by a variable they cannot obtain.
   */
  googleIosClientId:
    Platform.OS === 'ios'
      ? required('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)
      : process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
} as const;
