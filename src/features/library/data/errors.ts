import { ConvexError } from 'convex/values';

/**
 * Reading the codes `convex/model/auth.ts` throws.
 *
 * Every call site was otherwise going to compare strings against a shape it
 * assumed, which is how a renamed code turns into a silent "something went
 * wrong" that nobody notices for a release.
 */

export type LibraryErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_PROFILE'
  | 'FORBIDDEN'
  | 'INVALID'
  | 'UNKNOWN';

type ErrorPayload = { code?: unknown; message?: unknown };

export function codeOf(error: unknown): LibraryErrorCode {
  if (!(error instanceof ConvexError)) {
    return 'UNKNOWN';
  }
  const data = error.data as ErrorPayload | undefined;
  const code = data?.code;

  switch (code) {
    case 'UNAUTHENTICATED':
    case 'NO_PROFILE':
    case 'FORBIDDEN':
    case 'INVALID':
      return code;
    default:
      return 'UNKNOWN';
  }
}

/**
 * What to put in front of the reader.
 *
 * `INVALID` is the one code that carries a server message worth showing: it
 * names the field and the limit, and the server is the only place that knows
 * both. Everything else gets a sentence written here, because a raw backend
 * error is not an explanation.
 */
export function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as ErrorPayload | undefined;
    if (data?.code === 'INVALID' && typeof data.message === 'string') {
      return data.message;
    }
  }

  switch (codeOf(error)) {
    case 'FORBIDDEN':
      return 'That document is no longer in your library.';
    case 'UNAUTHENTICATED':
    case 'NO_PROFILE':
      return 'Sign in again to continue.';
    default:
      return fallback;
  }
}
