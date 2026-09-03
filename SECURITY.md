# Security

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private advisory form:

<https://github.com/BotCoder254/pidom/security/advisories/new>

Anything that could expose a reader's documents, their Google identity, or
another account's data belongs there. Expect an acknowledgement within a few
days.

Useful things to include: what an attacker needs to start (a token? a document
id? nothing?), what they can reach, and whether it works against another
account's data or only their own.

## What the threat model actually is

Pidom holds somebody's personal documents. The interesting boundary is not the
app — it is between one reader's library and another's.

Three properties hold that line, and a report that breaks any of them is a real
vulnerability:

1. **No public Convex function takes an owner id.** Identity is read from a
   Google ID token that Convex verified against Google's JWKS, through
   `convex/model/auth.ts`. There is no argument a caller can set to read
   somebody else's library.
2. **Ownership is checked on the row, not the request shape.** `assertOwner`
   reports a missing document and another account's document identically, so a
   caller cannot enumerate which ids exist.
3. **Object keys never cross the wire.** Files live in Cloudflare R2 under
   `<ownerId>/<documentId>`, minted server-side. The client receives a signed
   URL that expires in five minutes and never a key.

## Known and accepted

- **A download URL is a capability for five minutes.** The ownership check runs
  when the URL is minted, not on the request that moves the bytes. This is
  weaker than the authenticated route it replaced, and it is what makes 100 MB
  documents possible at all — Convex caps an HTTP action response at 20 MiB.
  Anyone who captures a URL within its window can fetch that one document.
- **There is no per-user rate limiting yet.** An authenticated caller can drive
  writes as fast as Convex will accept them. It affects only their own data and
  their own quota, and it should land before this repository takes outside
  contributions.
- **`EXPO_PUBLIC_*` values are in the bundle.** A Convex deployment URL and
  OAuth client IDs are public identifiers. The Google *client secret* is not
  among them and must never be — the native ID token flow never needs one.

## Not vulnerabilities

- Reading values out of a shipped binary that are documented as public.
- Anything requiring physical access to an unlocked device.
- A reader accessing their own data through an unexpected route.
