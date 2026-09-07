/**
 * The account this device last signed in as.
 *
 * Not a credential. There is no token here and there never will be — the ID
 * token lives in a ref for the life of a session and nowhere else, for the
 * reason `session-provider.tsx` gives. What this holds is the answer to a
 * different question: *whose library is on this phone?*
 *
 * That question has to be answerable with no network, because the answer names
 * the directory the PDFs are in and the database beside them, both of which are
 * scoped to a profile id. Without it a reader in aeroplane mode is shown a
 * sign-in screen in front of documents that are already on their disk.
 *
 * The record is only trusted alongside `GoogleSignin.hasPreviousSignIn()`,
 * which is synchronous and offline. Google saying an account is still signed in
 * on this device, plus this saying which profile that was, is enough to open a
 * local library. It is not enough to reach the backend, and it is not treated
 * as if it were: Convex still refuses every request that arrives without a
 * token it has verified against Google's JWKS.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { log } from '@/lib/logger';

const SCOPE = 'local-account';
const KEY = 'pidom.account';

/**
 * How long a remembered identity may open the library without being verified
 * again.
 *
 * Thirty days rather than for ever. A phone that is never online again is a
 * phone that was lost or sold, and an identity with no expiry would read a
 * library on it until the battery died. Thirty days is longer than any trip and
 * shorter than any of that.
 */
export const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export type LocalAccount = {
  /** The Convex `users` row id. Names the library directory and the database. */
  profileId: string;
  /** When the library was created. The one profile fact a screen renders. */
  createdAt: number;
  /** Google's `sub`. Checked against the account Google restores, when it can. */
  googleId: string;
  email: string;
  name: string | null;
  photoUrl: string | null;
  /** When a Google token was last verified. The clock the grace window runs on. */
  verifiedAt: number;
};

/** A record is only complete once Convex has answered with a profile id. */
function isComplete(value: unknown): value is LocalAccount {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.profileId === 'string' &&
    record.profileId !== '' &&
    typeof record.createdAt === 'number' &&
    typeof record.googleId === 'string' &&
    record.googleId !== '' &&
    typeof record.email === 'string' &&
    typeof record.verifiedAt === 'number'
  );
}

/**
 * The remembered account, or `null` when there is none to remember.
 *
 * A half-written record — Google answered but Convex never did — reads as
 * `null` rather than as a usable identity, because a profile id is the whole
 * point and a record without one names no library. That is also why
 * `createdAt` is part of completeness rather than an optional extra: the two
 * are written together, by the one caller that has ever seen a profile row.
 */
export async function readAccount(): Promise<LocalAccount | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isComplete(parsed) ? parsed : null;
  } catch (error) {
    // A record that will not parse is a record that cannot be trusted. Treating
    // it as absent sends the reader to sign in, which always works.
    log.warn(SCOPE, 'could not read the remembered account');
    log.debug(SCOPE, 'read failed', error);
    return null;
  }
}

/**
 * Merges what a caller knows into the record.
 *
 * Two callers know two halves at two different moments: the session knows the
 * Google account the instant a token is minted, and `useProfile` knows the
 * profile id only once Convex has answered. Merging rather than replacing is
 * what lets each write its own half without erasing the other's.
 */
export async function rememberAccount(part: Partial<LocalAccount>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const previous: unknown = raw === null ? {} : JSON.parse(raw);
    const base = typeof previous === 'object' && previous !== null ? previous : {};

    await AsyncStorage.setItem(KEY, JSON.stringify({ ...base, ...part }));
  } catch (error) {
    // Best effort. Failing here costs the reader an offline launch, not any
    // data, so it must not take the sign-in down with it.
    log.warn(SCOPE, 'could not remember the account');
    log.debug(SCOPE, 'write failed', error);
  }
}

export async function forgetAccount(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (error) {
    log.warn(SCOPE, 'could not forget the account');
    log.debug(SCOPE, 'clear failed', error);
  }
}

/** Whether a remembered identity is still inside its grace window. */
export function isWithinGrace(account: LocalAccount, now: number): boolean {
  return now - account.verifiedAt < OFFLINE_GRACE_MS;
}
