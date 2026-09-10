/**
 * The only module that imports `@react-native-google-signin/google-signin`.
 *
 * Everything above this file works with the discriminated results below and
 * never sees a native error, a status code, or the library's response shapes.
 * That containment is what makes the identity provider swappable: replacing
 * Google, or moving to a backend-issued session, is a rewrite of this file and
 * `use-convex-google-auth.ts`, not of the app.
 */
import {
  GoogleSignin,
  isErrorWithCode,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { log } from '@/lib/logger';

const SCOPE = 'google-client';

/** The subset of the Google account the app displays. */
export type GoogleAccount = {
  id: string;
  email: string;
  name: string | null;
  photoUrl: string | null;
};

/**
 * Why a sign-in did not produce a token.
 *
 * - `cancelled` — the reader dismissed the sheet. Not an error; say nothing.
 * - `no-saved-credential` — nothing to restore silently. Expected on first run.
 * - `play-services` — Android only, and the reader can act on it.
 * - `network` / `unknown` — worth a retry.
 */
export type GoogleFailureReason =
  | 'cancelled'
  | 'no-saved-credential'
  | 'play-services'
  | 'network'
  | 'unknown';

export type GoogleResult =
  | { ok: true; account: GoogleAccount; idToken: string }
  | { ok: false; reason: GoogleFailureReason };

let configured = false;

/**
 * Applies the Google configuration. Cheap, synchronous, and safe to call more
 * than once, so every entry point calls it rather than depending on some other
 * module having run first.
 */
export function configureGoogleSignIn(): void {
  if (configured) {
    return;
  }

  GoogleSignin.configure({
    // Required for `idToken` to be populated, on both platforms. This is the
    // audience Convex checks against `applicationID`.
    webClientId: env.googleWebClientId,
    iosClientId: env.googleIosClientId,
    // `openid` is what makes the response an OIDC ID token rather than a bare
    // access token; `email` and `profile` fill in the claims the profile row
    // stores.
    scopes: ['openid', 'email', 'profile'],
    // Pidom never calls Google APIs from a server, so it has no use for a
    // refresh token and no reason to hold a client secret.
    offlineAccess: false,
  });

  configured = true;
}

function toAccount(user: {
  id: string;
  email: string;
  name: string | null;
  photo: string | null;
}): GoogleAccount {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    photoUrl: user.photo,
  };
}

function classify(error: unknown): GoogleFailureReason {
  if (isErrorWithCode(error)) {
    switch (error.code) {
      case statusCodes.SIGN_IN_CANCELLED:
        return 'cancelled';
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return 'play-services';
      case statusCodes.IN_PROGRESS:
        // A second sheet while one is open. Treated as a cancel so the caller
        // does not show an error for what is really a double tap.
        return 'cancelled';
      default:
        log.warn(SCOPE, `native error ${error.code}`, error.message);
        return 'unknown';
    }
  }
  log.warn(SCOPE, 'non-native error', error);
  return 'network';
}

/**
 * Opens the native account sheet.
 *
 * `hasPlayServices` runs first on Android because without it the failure
 * surfaces as an opaque native error rather than something the reader can act
 * on. It is a no-op on iOS.
 */
export async function signInInteractively(): Promise<GoogleResult> {
  configureGoogleSignIn();

  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      return { ok: false, reason: 'cancelled' };
    }
    if (response.data.idToken === null) {
      // Reaching here means `webClientId` was wrong or missing: Google
      // authenticated the account but issued no ID token, so there is nothing
      // Convex can verify.
      log.error(SCOPE, 'signed in but no idToken — check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
      return { ok: false, reason: 'unknown' };
    }

    return {
      ok: true,
      account: toAccount(response.data.user),
      idToken: response.data.idToken,
    };
  } catch (error) {
    return { ok: false, reason: classify(error) };
  }
}

/**
 * Restores a session without any UI, and mints a fresh ID token in the process.
 *
 * Serves two jobs: the cold-launch restore, and the hourly refresh. It is the
 * refresh path that matters most — `getTokens` alone does not reliably return a
 * new token on Android.
 */
export async function signInSilently(): Promise<GoogleResult> {
  configureGoogleSignIn();

  try {
    const response = await GoogleSignin.signInSilently();

    if (isNoSavedCredentialFoundResponse(response)) {
      return { ok: false, reason: 'no-saved-credential' };
    }
    if (!isSuccessResponse(response) || response.data.idToken === null) {
      return { ok: false, reason: 'unknown' };
    }

    return {
      ok: true,
      account: toAccount(response.data.user),
      idToken: response.data.idToken,
    };
  } catch (error) {
    return { ok: false, reason: classify(error) };
  }
}

/**
 * Drops Google's cached tokens so the next silent sign-in has to mint new ones.
 *
 * Android caches the ID token and will hand back the same expired string from
 * `getTokens` until the cache is cleared, so this runs before every refresh
 * attempt. It does nothing on iOS, where `getTokens` refreshes on its own.
 *
 * https://github.com/react-native-google-signin/google-signin/issues/926
 */
export async function clearTokenCache(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    const { accessToken } = await GoogleSignin.getTokens();
    await GoogleSignin.clearCachedAccessToken(accessToken);
  } catch (error) {
    // Best effort. Failing here just means the refresh below may return the
    // cached token, which the caller already checks for.
    log.debug(SCOPE, 'could not clear token cache', error);
  }
}

export async function signOut(): Promise<void> {
  configureGoogleSignIn();
  try {
    await GoogleSignin.signOut();
  } catch (error) {
    // Sign-out is local state. If the native call fails the app still drops its
    // own session, which is the part the reader asked for.
    log.warn(SCOPE, 'native sign-out failed; clearing local session anyway', error);
  }
}

/** Whether Google holds a session, without touching the network. */
export function hasPreviousSignIn(): boolean {
  configureGoogleSignIn();
  return GoogleSignin.hasPreviousSignIn();
}
