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

  `expo-secure-store` is now used, by exactly one thing: the password for an
  encrypted PDF, when the reader asks this device to remember one. See **A
  document is not a trusted input** below.

`Stack.Protected` in `src/app/_layout.tsx` decides what renders. It is not
access control — the backend checks stand on their own.

## Rate limits

Per-user write limiting is `@convex-dev/rate-limiter`, configured in
`convex/model/rateLimits.ts`. It sits in front of `importDocument`,
`uploadUrl`, `downloadUrl`, `reprocess`, `setProcessed`, `recordProgress`, `bookmark` and
collection creation.

`recordProgress` is the newest and is there because the reader changed shape.
It used to be called once, on the way out of a document, and is now called on a
fifteen-second debounce as well — which makes it the most frequent mutation in
the application. The bucket is sized so that reading cannot reach it: four
writes a minute at the very worst, against a ceiling of 240 an hour.

`setProcessed` was the one the first pass missed, and it writes the most per
call: a patch on `documents` plus a whole replacement `documentOutline` row. It
also used to *accept* four times the table of contents it kept — 2,000 entries
validated in order to store 500 — so the limit in `limits.ts` was a claim about
what got in rather than a fact. It refuses at the number it honours now.

`uploadUrl` is the one that mattered most. It mints a signed PUT against a Cloudflare
bucket Pidom is billed for, and until this landed a verified Google account was
enough to fill it a hundred megabytes at a time. `reprocess` is next: each call
is a Node action that pulls a file out of R2 and runs pdf.js over it, and it is
the only expensive thing a reader can ask for repeatedly by tapping.

Token buckets rather than fixed windows, keyed on the profile row's id and never
on anything the caller sends. A reader who adds nine books in one evening is
doing something real; a fixed window would refuse the tenth for no reason a
person could understand.

**Reads are not covered, search included.** That is a limitation rather than a
decision: spending a token is a write, and a Convex query cannot write, so a
rate limit on a query is not expressible. Declaring one that nothing enforces
would be worse than declaring none. Reads stay bounded the way every read in
this backend is — `.take(n)`, never `.collect()`.

## Parsing a file nobody here wrote

`convex/node/extract.ts` is the one place a server-side parser is pointed at a
document the reader supplied, so it is bounded on every axis it has: 32 MB,
2,000 pages, 8 KB of text kept per page, and a two-minute timeout the parse
cannot outlive — `unpdf`'s serverless build parses on the event loop with no
worker to kill, so a PDF that sends pdf.js spinning can only be outlived. No
font machinery is enabled: there is no display in an action, and a font program
is one more parser to hand a hostile document to.

`isEvalSupported: false` is conspicuously absent, and that is checked rather
than forgotten. The option existed to close CVE-2024-4367, where pdf.js passed a
font's `FontMatrix` straight to `eval()`. `unpdf` 1.8.1 bundles pdf.js 6.1.200,
which removed the eval path entirely — the shipped bundle contains no `eval(`
and no `new Function(`, and the option is no longer in
`DocumentInitParameters`. What holds here is the version, so an upgrade of
`unpdf` is worth re-checking against.

Two things reach the client from that action, and neither is content: counts,
and error **codes**. A thrown pdf.js message can carry a fragment of the
document, so `documentJobs.error` and `documents.processingError` are codes and
the client owns every sentence a reader reads.

## What a file has to be to get in

Import used to accept anything whose MIME type said `application/pdf` **or**
whose name ended `.pdf`, and neither is the reader's to be trusted with: Android
file managers report `application/octet-stream` for real PDFs often enough that
refusing on MIME type alone would refuse real documents, and a filename is a
string somebody chose. A `.docx` renamed `.pdf` imported cleanly and opened to
nothing.

Now the first five bytes have to read `%PDF-` before the file is staged, and a
PDF with a password is refused by the probe rather than logged at debug — an
encrypted document used to get a tinted cover, a row, and a blank reader with no
explanation.

The same check stands in front of a document another app hands over through
"Open with". That path never goes near the picker, so it would otherwise be a
way into the library with no validation at all — and another app's idea of a PDF
is exactly as trustworthy as a filename. The incoming file is also staged under
a UUID rather than the name it arrived with, for the reason every other file in
this app is: a name chosen elsewhere never becomes a path segment here.

The table of contents that comes off that same load is **client-supplied data**
and is treated as such: `Processing.setOutline` bounds the entry count, the
depth and every title through the same `cleanText` a document title goes
through, and clamps every page number against the document's own `pageCount`. A
PDF is a file somebody else wrote, and it can declare a bookmark titled with a
megabyte pointing at page `1e9`.

## A document is not a trusted input

The import checks that a file is a PDF and refuses one with a password, and
`convex/node/extract.ts` parses it under a bound on every axis. All of that is
about a file *arriving*. The reader is about a file being **rendered**, on the
device, by a native viewer, and it has its own surface.

Two of `react-native-pdf`'s defaults are not defaults this application should
inherit silently, so both are written out on every `<Pdf>` mount — the reader,
both panes of a spread, and the import probe.

`trustAllCerts` defaults to **`true`**, which disables certificate validation
entirely. Nothing here fetches over the network: the reader is handed a
`file://` URI and the probe a staged one. That is precisely why it is set to
`false` rather than left alone — the guarantee should be a property of the code
rather than of a fact about today's call sites.

`enableAnnotationRendering` also defaults to `true`, and stays true. Links are
content, and a textbook whose cross-references do nothing is a worse textbook.
What makes it safe is the callback that was previously unset: with no
`onPressLink`, tapping a link did nothing at all — safe, but by accident rather
than by design, and one prop away from not being.

`src/features/reader/open-pdf-link.ts` parses the URL and **allows `https:`
only** — and it does not trust the parser for the decision, because which
parser runs is not obvious. React Native ships a homemade `URL` whose
constructor never validates a single-argument call and whose every getter is a
regex over the raw string. Expo overwrites it: `expo/src/Expo.fx.tsx` imports
`./winter` as its first statement, and that installs `whatwg-url-minimum`. So
the app gets a real WHATWG parser — and that package's own README says it
*"drops punycode/unicode support"*.

No IDNA is the part that matters, because the host **is** the security control
here. `https://аpple.com` with a Cyrillic `а` keeps its Cyrillic host through
parsing and renders identically to `apple.com` in the dialog whose whole purpose
is letting somebody judge the host. A real `URL` would have shown
`xn--pple-43d.com`. So the host is validated rather than trusted: printable
ASCII before parsing, then DNS shape, 253 characters, labels of 63, no
credentials, no backslash. A citation link in a document is ASCII; a lookalike
is not. The dialog also ellipsises **from the head**, so the rightmost labels —
the ones that decide where a link goes — are the ones always on screen. Not a blocklist of `javascript:` and `data:`, because a blocklist is a
list of the attacks somebody thought of. An allowlist of one scheme also covers
`file:` and `content:`, which are the interesting ones here — this application
registers itself as a handler for both, so a PDF that could hand one back would
be reaching into the device through a document. Plain `http:` is refused too.
What survives is shown to the reader host-first, with the whole URL underneath,
and opened only if they agree; the URL followed is the one this code parsed and
rebuilt, never the string the document supplied.

Selected text is document content, so it is bounded by `PAGE_TEXT_MAX` — the
same number a page of extracted text gets — before it reaches the clipboard, and
it is never logged, not even its length. `enableTextSelection` had been on the
whole time as the package's default, which meant iOS readers could already
select and share text with nothing here knowing; it is now stated rather than
inherited.

A password for an encrypted PDF goes to `expo-secure-store`, keyed by document
id, and nowhere else. It is not an argument to any Convex function, it is not
written to the document row, and it is not logged — not even its length, since a
length is a fact about a secret. `AsyncStorage` would have been the wrong store:
the reader-preferences blob is readable by anything that can read the app's data
directory on a rooted device. It is deleted when the document is deleted and
when its local copy is removed, because a credential outliving the thing it
unlocks is a credential nothing will ever come back for.

## The nightly sweep deletes, so it has to be sure

`library.sweepOrphanedObjects` removes R2 objects nothing references any more —
the file from an upload whose `attachUpload` never arrived, which is billed
storage no screen can reach.

It used to answer "is this referenced?" by building a set of every key named by
`ctx.db.query('documents').take(SWEEP_LIMIT)` and deleting any object missing
from it. That query has no index, so it returns the oldest two thousand rows
**in the deployment**, across every account — and the set it produced was
therefore not "everything referenced" but "everything referenced by the oldest
two thousand rows". Every object belonging to a newer row was, by construction,
an orphan.

The comment that justified it said a library past the limit gets swept over
several nights. That is true of the *candidate* list and false of the
*reference* set. A list of candidates can be paged. An allowlist cannot: one
with holes in it is a delete list.

It needed no attacker — two thousand local-only imports across the whole user
base is enough, and the schema calls local-only the normal state. With one it
was faster: `importDocument` writes a row and needs no file, so filling that
window with rows that have no `storageKey` emptied the allowlist completely.

The sweep now asks the question one object at a time. A key carries the ids that
produced it, so `documentIdOf` recovers the document, one point lookup fetches
that row, and the object survives only if the row still names **this exact key**.
Correct whatever the deployment holds, and cheaper than the scan it replaced.
`documentIdOf` lives beside `pdfKey` and `coverKey` in `convex/model/library.ts`,
because a parser that drifts from its printer eventually disagrees with it.

## Where document text lives

Searching inside a document needs the document's words, and the only copy of a
file the server can see is the one in Cloudflare R2. So **the text of every
synced document is extracted into Convex**, a row per page, and that is a real
change in what the account holds: metadata and a blob became metadata, a blob,
and readable content.

It follows the reader's decision rather than outliving it. Only a synced
document is extracted; `detachUpload` deletes the pages along with the cloud
copy, `removeDocument` deletes them with everything else, and the nightly prune
finishes any book too long to clear inside one mutation. A local-only document
has no `textStatus` at all, because nothing could have given it one.

The search index is filtered on `ownerId`, which is load-bearing in the way it
is on `search_title`: a search index has no implicit scope, so without the
filter one reader's query would range over every page of every document in the
deployment.

**It also lives on the device now**, in an `expo-sqlite` FTS5 database, so a
book can be searched with no connection. One database per profile, named after
the profile id — the same rule the library directory follows, and for the same
reason: signing in as somebody else must not reach the previous reader's words.
`library.pagesOf` is the one query in the whole backend that hands a client
document *content* rather than metadata, and it is owner-checked on the document
before a single page row is read.

The mirrored copy follows the file. `deleteDocument` and `removeDownload` both
call `forgetLocally`, because a delete that leaves the reader's document text in
a database on their phone is a delete that did not happen. So does a reader who
stops syncing: no cloud copy means no extraction, and nothing left to mirror.

The nightly collector for the cloud side is worth a line here rather than only in
the architecture: its first version scanned the head of `documentPages` for
orphans, which reads the oldest rows in the deployment and therefore almost
always a document that is fine. It collected nothing, every night, while
orphaned text — the reader's own content, outliving their decision to remove it
— accumulated. Orphans are recorded on the way out now, not hunted for.
