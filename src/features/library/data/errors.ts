import { ConvexError } from 'convex/values';

/**
 * Reading the codes `convex/model/auth.ts` throws.
 *
 * Every call site was otherwise going to compare strings against a shape it
 * assumed, which is how a renamed code turns into a silent "something went
 * wrong" that nobody notices for a release.
 */

export type LibraryErrorCode =
  'UNAUTHENTICATED' | 'NO_PROFILE' | 'FORBIDDEN' | 'INVALID' | 'RATE_LIMITED' | 'UNKNOWN';

type ErrorPayload = { code?: unknown; message?: unknown; retryAfter?: unknown };

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
    case 'RATE_LIMITED':
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

  if (codeOf(error) === 'RATE_LIMITED') {
    // The server sends how long, in milliseconds, so the sentence can say when
    // rather than only no. See `convex/model/rateLimits.ts`.
    const data = (error as ConvexError<never>).data as ErrorPayload | undefined;
    return typeof data?.retryAfter === 'number'
      ? `Too many in a short time. Try again in ${describe(data.retryAfter)}.`
      : 'Too many in a short time. Try again shortly.';
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

/** How long the server asked a caller to wait, in milliseconds, or `null`. */
export function retryAfterOf(error: unknown): number | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }
  const data = error.data as ErrorPayload | undefined;
  return typeof data?.retryAfter === 'number' ? data.retryAfter : null;
}

/** Milliseconds as a person would say them. Rounded up, so it is never early. */
function describe(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
