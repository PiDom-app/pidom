# Security

Identity, ownership, and the choices behind both.

## How identity works

```
native Google sheet  →  Google ID token  →  Convex verifies it  →  users row
```

A Google ID token is an OIDC JWT. `convex/auth.config.ts` registers
`https://accounts.google.com` as an OIDC provider, so Convex fetches Google's
JWKS and verifies the signature itself — there is no auth server in between and
no session to keep in sync.

`applicationID` is the part that makes this safe. It pins the accepted audience
to Pidom's own web client ID; without it, a token minted for any other Google
application would verify here.

Three rules follow from that, and the code holds to all three:

- **The client never names an owner.** No Convex function takes a user id.
  Identity is read from the verified token via `ctx.auth.getUserIdentity()`.
  The one apparent exception proves it: `library.byIds` takes ids the device
  found on its own disk, and answers only for rows the caller owns — dropping
  the rest silently rather than erroring, so it cannot be used to probe which
  ids exist.
- **`convex/model/auth.ts` is the only door.** `requireIdentity`, `requireUser`
  and `assertOwner` live there, and owner-scoped reads go through a `by_owner`
  index rather than a filter. A membership write names two ids and checks both:
  the collection *and* the document.
- **A type validator is not a value validator.** `v.string()` accepts a
  megabyte. `convex/model/limits.ts` holds every bound the public surface
  enforces, each with the reason for its number, and every list read is
  `.take(n)` rather than `.collect()`.
- **The client gates on the profile, not on the token.** Every library function
  starts with `requireUser`, which throws `NO_PROFILE` when a token verifies
  before `ensureProfile` has written the row — and `convex/react`'s `useQuery`
  re-throws a query error *during render*. On a first sign-in the authenticated
  layout mounts the bootstrap and the home screen in the same commit, so without
  `useLibraryStatus().ready` in front of every query, a new account's first
  launch renders a thrown error instead of a library. Softening `requireUser`
  was the alternative, and it would have hidden a real failure — a token that
  verifies against a profile that vanished — behind an empty library on every
  function.
- **Every authenticated route exports an `ErrorBoundary`.** For the same reason:
  a query error has no field to branch on, so a collection deleted on another
  device while its screen is open would otherwise be a blank screen with no way
  out but a force-quit. `src/components/feedback/screen-error.tsx` reads the
  code and offers a retry.
- **The token is never written down.** It lives in memory for the life of the
  session; Google's native SDK is what persists the account across launches, so
  there is no credential at rest for the app to leak. `AsyncStorage` holds the
  theme preference and nothing that authenticates anything.

  `expo-secure-store` is still installed and its config plugin is still in
  `app.json`, but nothing imports it — it is kept for the reader capability,
  which will need somewhere to put document keys.

`Stack.Protected` in `src/app/_layout.tsx` decides what renders. It is not
access control — the backend checks stand on their own.

## What is not covered yet

Per-user write rate limiting. It wants `@convex-dev/rate-limiter`, which is a
component install rather than a line in a screen, and it should land before the
repository opens to contributions that can call these functions.
