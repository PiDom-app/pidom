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
  the collection _and_ the document.
- **A type validator is not a value validator.** `v.string()` accepts a
  megabyte. `convex/model/limits.ts` holds every bound the public surface
  enforces, each with the reason for its number, and every list read is
  `.take(n)` rather than `.collect()`.
- **The client gates on the profile, not on the token.** Every library function
  starts with `requireUser`, which throws `NO_PROFILE` when a token verifies
  before `ensureProfile` has written the row — and `convex/react`'s `useQuery`
  re-throws a query error _during render_. On a first sign-in the authenticated
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
`convex/model/rateLimits.ts`. **Every public mutation now spends a bucket**,
which is a stronger claim than this page could make before: `importDocument`,
`uploadUrl`, `downloadUrl`, `reprocess`, `setProcessed`, `recordProgress`,
`bookmark`, `annotation`, `attachUpload`, `removeDocument`, `editDocument`,
`editCollection`, collection creation — and the last two holdouts,
`users.ensureProfile` and `r2.syncMetadata`.

Those two were not holes; both are ownership-bound. They were simply unmetered,
and each does real work. `syncMetadata` schedules an R2 HEAD and a component
write per call against a bucket Pidom is billed for. `ensureProfile` is the more
interesting one: it is the only mutation reachable with nothing but a verified
Google token, because every other write needs the profile row that this call
creates. Its bucket is therefore spent _after_ the row exists rather than
before — `limit` is keyed on the profile's id, and on a first sign-in there is
no profile to key on. So an account's very first call is always allowed and
every call after it is metered, which is the right way round: refusing the first
one would refuse the account.

`recordProgress` is the newest and is there because the reader changed shape.
It used to be called once, on the way out of a document, and is now called on a
fifteen-second debounce as well — which makes it the most frequent mutation in
the application. The bucket is sized so that reading cannot reach it: four
writes a minute at the very worst, against a ceiling of 240 an hour.

`setProcessed` was the one the first pass missed, and it writes the most per
call: a patch on `documents` plus a whole replacement `documentOutline` row. It
also used to _accept_ four times the table of contents it kept — 2,000 entries
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
about a file _arriving_. The reader is about a file being **rendered**, on the
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
_"drops punycode/unicode support"_.

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
it is never logged, not even its length. A **kept** passage takes the tighter
bound, `ANNOTATION_TEXT_MAX` at a quarter of it: a clipboard holds a page for a
moment and a row in a list holds one until somebody deletes it. The server
re-checks both, because a client bound is a convenience and not a control.

A note is the same content by a different route, and `documentAnnotations`
carries it under the rules every other owned table follows: the client never
names an owner, every read is owner-checked on the _document_ before a row is
touched — so an id the caller does not own answers `FORBIDDEN` rather than an
empty list, which would have said the document exists — and a write that names
an annotation checks the annotation **and** the document behind it, so a row
cannot outlive the ownership it was created under. Writes spend a token bucket
of their own, and the per-document ceiling in `limits.ts` is the harder bound
the bucket exists to keep anybody from reaching quickly.

### A debug probe that shipped

`reader-canvas.tsx` carried a block marked `TEMP DIAGNOSTIC` that ran on every
load of the two-page mode. It wrote the page count and the first six entries of
the document's table of contents into `Paths.cache/toc-probe.json` — the
reader's own document content, in a file nothing ever deleted, on every open. It
had presumably answered a question about `tableContents` once and then stayed.

It is gone, and the argument it lost to is the one this whole section makes: a
selection is bounded before it reaches a clipboard and never logged, and an
outline is the same file's words. Nothing about a diagnostic makes the content
in it different content.

The fourth argument it was printing is now used rather than dumped.
`library.recordOutline` writes it when the row has none — a document imported
before outlines existed, or one whose probe failed, had a Contents list in its
file that this app would never see however many times somebody opened it. It is
a separate mutation from `setProcessed` deliberately: that one writes the
processing state beside the outline, and a reader who has rendered a document
knows nothing about whether a cover was ever made for it, so routing through it
would promote a `partial` document to `ready` for being opened. `enableTextSelection` had been on the
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
several nights. That is true of the _candidate_ list and false of the
_reference_ set. A list of candidates can be paged. An allowlist cannot: one
with holes in it is a delete list.

It needed no attacker — two thousand local-only imports across the whole user
base is enough, and the schema calls local-only the normal state. With one it
was faster: `importDocument` writes a row and needs no file, so filling that
window with rows that have no `storageKey` emptied the allowlist completely.

**It also has to survive a shared bucket.** Dev and prod point at the same R2
bucket, so each deployment's sweep sees objects belonging to the other's
documents — which have no row here, by definition. Asking only "is there a
document row?" would call every one of them an orphan, and whether that fired
came down to whether `normalizeId` accepts an id minted by another deployment.
That is not a guarantee anybody's files should rest on.

So the **owner is checked first**. A key is `<ownerId>/<documentId>`, and a
`users` row is deployment-local: an owner id from elsewhere either fails to
normalise or names a row that is not here, and the object is left alone either
way. A genuine orphan from this deployment still has its owner, so it is still
collected. The cost is that objects belonging to a deleted account outlive it —
and there is no account-deletion flow, so today that costs nothing.

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
document _content_ rather than metadata, and it is owner-checked on the document
before a single page row is read.

The mirrored copy follows the file. `deleteDocument` and `removeDownload` both
call `forgetLocally`, because a delete that leaves the reader's document text in
a database on their phone is a delete that did not happen. So does a reader who
stops syncing: no cloud copy means no extraction, and nothing left to mirror.

### That database is encrypted, conditionally

It is worth saying which half of that is a guarantee. The database holds the
reader's titles, their notes, and the full text of every document they have
synced, so it is opened under **SQLCipher**: `PRAGMA key` is the first statement
on the connection, and the key is 256 bits from the platform's own generator,
kept in `expo-secure-store` under `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and never
derived from anything a person types. It is a raw key rather than a passphrase,
so there is no KDF to get wrong. `app.config.ts` turns the cipher on through the
`expo-sqlite` config plugin (`useSQLCipher`), which is a **build** flag.

Which was the hole, and it was not theoretical. A build made without the flag
opens the same file unencrypted and SQLite does not complain: `PRAGMA key` on a
plain build is accepted and ignored. `app.config.ts` carries `useSQLCipher: true`
the whole time — but the config plugin only runs during `prebuild`, and this
project commits `android/` and `ios/`, which were generated before the flag was
added. It never reached a build. The database on a real device began with the
bytes `SQLite format 3`, in the clear, holding every title, note and page of
extracted text.

So the cipher is verified rather than assumed, and the verification now
**fails closed**. `PRAGMA cipher_version` is read before anything is written,
and a build that cannot answer it does not get a database at all:
`database()` returns `null`, `databaseFault()` says `no-cipher`, and Home and
`/storage` say so in words instead of rendering an empty library. Losing the
offline library to a misconfigured build is a bad day. Writing somebody's
documents to disk in the clear while the app's own documentation promises
otherwise is a different kind of thing, and not one to trade for convenience.

Turning the cipher on had to deal with what the broken builds left behind.
Keying an existing plaintext file makes every read fail, so `adoptPlaintext`
recognises that case — the file opens with no key and reads as a database —
attaches a keyed copy, runs SQLCipher's own `sqlcipher_export` into it, carries
`user_version` across by hand, and swaps the files. The original is deleted only
once the copy is in place, so a process killed halfway leaves the old file
intact and tries again. A file that is neither keyable nor plaintext is
discarded and rebuilt from the account.

The PDFs themselves are **not** encrypted, and that is not an oversight. They
are handed to `react-native-pdf` as a `file://` URI, so a key would have to be
given to a native renderer that has no way to take one. What protects them is
the platform: application-private storage under a per-profile directory. The
database is the part that could be encrypted, so it is.

The nightly collector for the cloud side is worth a line here rather than only in
the architecture: its first version scanned the head of `documentPages` for
orphans, which reads the oldest rows in the deployment and therefore almost
always a document that is fine. It collected nothing, every night, while
orphaned text — the reader's own content, outliving their decision to remove it
— accumulated. Orphans are recorded on the way out now, not hunted for.

## Sharing

Everything above answers one question — does this row's `ownerId` equal the
caller's — and `assertOwner` is the whole of it. Sharing cannot be expressed
that way, so it adds a second authorization path and nothing else.

### A grant, not a copy

There is one `documents` row and one object in R2 however many people can open
it. `documentShares` says who else may, what they may do, and when that stops.
`documents.ownerId` never changes.

That decision is what makes the rest cheap. A group share is **one row**:
membership is resolved through `groupMembers` at the moment somebody asks, so a
person joining or leaving changes what they can open with no rows to insert and
none to remember to delete. It is also why there is no per-member accept step
for a group, and why `sharingSettings` has no `autoAcceptFromGroups` — there is
no per-member state for such a switch to govern, and a switch nothing enforces
reads as covered when it is not.

### `convex/model/access.ts` is the only door

`requireReadable`, `requireAnnotatable`, `requireDownloadable` and
`requireResharable`. Every function that touches a document on behalf of
somebody who might not own it calls one of them and nothing else. Four rules
hold across all of them:

- **The owner path is unchanged.** It is checked first and it is still
  `assertOwner`, so a document nobody has shared resolves in one `get`. Sharing
  did not make an owner's own access slower or weaker.
- **A grant is read, never remembered.** No session, no cached permission, no
  flag on `documents` saying it is shared. Removing access is a write to one
  row, and the next read sees it.
- **Refusals are indistinguishable.** A missing document, somebody else's
  document, and a revoked share all raise `FORBIDDEN`. Telling them apart would
  let a caller probe which document ids exist.
- **A reshare cannot grow.** `clampToCeiling` is applied to every create,
  including the owner's, so there is one code path rather than two that can
  drift. A `viewer` cannot hand somebody `annotator`; somebody who cannot
  download cannot let anybody else; and a reshare is never itself resharable.

Writes to the document row — renaming, filing, deleting, syncing — stay
owner-only. No role expresses them.

### Expiry is checked twice, and neither check is enough alone

`Access.grants` compares the clock on every resolution, so a caller who asks
after a share has lapsed is refused. But a Convex query is not re-run because
time advanced, so a screen that subscribed while the share was live goes on
rendering it. `Sharing.expireDue` writes `status` on a cron every fifteen
minutes, and a write is what invalidates a subscription.

It cannot be done lazily from the refusing mutation, which is the obvious design
and does not work: **a Convex mutation is one transaction, so a handler that
patches the row and then throws rolls the patch back with everything else.** The
first version did exactly that — the caller was refused and the row still said
`accepted` — and `convex/sharing.test.ts` is what caught it.

### The file moves the way it always did

A recipient downloads through `sharing.shareDownloadUrl`, which is
`library.downloadUrl` with `requireDownloadable` in front of it: a mutation,
because a query result is cached and a cached URL outliving its signature is a
download that fails for no visible reason. Same five-minute R2 signature, same
`DOWNLOAD_URL_SECONDS`, narrower rate-limit bucket — that egress is billed to
the sender and spendable by anybody they ever shared with.

Once downloaded, a shared document is an ordinary row in the recipient's
database with `ownedByMe` at 0 and `shareId` naming the grant. It opens with no
connection, takes bookmarks and notes, and appears in the library like anything
else. That is the point of putting sharing above the local-first library rather
than beside it.

### Finding people is a lookup, not a search

An exact `@handle` or an exact email address returns one row or none. Prefix
matching exists and reaches only people the caller already shares a group with —
their own graph rather than the deployment.

There is no search index over accounts and there is not going to be one. **A
Convex query cannot spend a rate-limiter token** — spending one is a write, and
a query cannot write — so a prefix index over `users.name` would be an
enumeration of every account, walkable one letter at a time, with nothing to
bound it.

`Discovery.toPublicProfile` is the only projection: id, display name, handle,
picture. Email is never in it, not even for a search that matched on one, and
the fallback for somebody with no name is their handle rather than their
address. `sharingSettings.findableBy` gates it, and a refusal is an empty result
rather than an error — an error would confirm the account exists.

Two endpoints were narrowed after an authz pass over the finished feature,
because both were the same enumeration reached through a different door:

- **`sharing.profile`** took a user id and returned a profile to anybody signed
  in. Search will not return a stranger, but this would have, to any caller who
  could get hold of an id. It now needs something between the two accounts — a
  group in common, or a share in either direction — and returns `null`
  otherwise, for the same reason a search refusal is empty rather than an error.
- **`sharing.accessList`** was readable by anybody who could read the document,
  which let one recipient enumerate every other person the owner had shared
  with. Being handed a document is not being handed the owner's address book.
  The owner sees all of it; anybody else sees only the shares they made
  themselves, which is what a resharer needs to take one back.

### Notifications say nothing about the document

A `shareEvents` row is the fact, written in the same transaction as the thing it
describes. A push is one attempt to draw attention to it and is allowed to fail:
muted, quiet hours, a wiped device, Expo down. The inbox is still right.

The body is "Amina shared a PDF with you" and never the title.
`Notifications.bodyFor` is the one place those strings are written, so there is
one place to audit. The payload carries `{ kind, shareId }` — identifiers the
app trades for content through an authenticated query. A notification renders on
a locked screen, often face-up on a desk, and the reader has not proved they are
the reader.

A push token never comes back out of the API. It identifies a handset to a third
party, the operating system cycles it, and there is nothing a client could do
with one that re-registering would not do.

### Presence is ephemeral, and its door is checked twice

`@convex-dev/presence` keeps the state; `convex/presence.ts` is the door.

The React Native hook's signature is `usePresence(api, roomId, userId, interval)`,
so **a user id crosses the wire on every heartbeat and is thrown away**. A client
that could name whose presence it was recording could put anybody in any room.
The identity comes from the verified JWT.

A room name is `document:<id>` or `group:<id>` — a Convex id in a string, so
guessable. Both `heartbeat` and `inRoom` resolve it back to a document or a
group and run the same access check the reader does.

**Two settings, two questions.** `showOnlineStatus` is whether this account
appears beside its name anywhere at all — a member list, a Manage access row.
`showReadingActivity` is narrower: whether being in a _document_ right now is
something the people that document is shared with get to see. A document room
needs both; a group room needs only the first, because being a member who is
around says nothing about what anybody is reading. Neither refuses the
heartbeat — refusing would make the client retry forever. The account enters
and is removed, so it sees others and is not itself seen, which is what the
settings say.

`showReadingActivity` governed nothing until this was written. It defaulted to
`false`, which read as caution and was not: a switch wired to no behaviour is
not a protection, and leaving it off once it _did_ govern something would have
meant the feature was disabled by a default rather than by anybody's decision.
It defaults to `true` now, and the audience is never the deployment — it is the
handful of accounts that can already open the file.

**The heartbeat is mounted, not skipped.** `usePresence` has no disabled state:
it fires on its interval whatever room id it is handed. The first version passed
an empty string for a document with nobody to show it to, so every synced
document beat a mutation every ten seconds that the server refused _after_
spending a token from the 600-an-hour presence bucket — a reader exhausting
their own budget doing nothing. The hook now lives in a component rendered only
when there is a room to be in.

`disconnect` is deliberately unauthenticated, and the export name cannot be
renamed. The hook tears a session down with a bare `fetch` to `/api/mutation` at
the literal path `presence:disconnect`, carrying no auth header. A session token
is minted by the component and unguessable, and the only thing it authorises is
ending the session it names. `requireUser` there would not add a check; it would
break every clean disconnect and leave rooms full of people who closed the app.

### The thing the UI has to keep saying

**Removing access does not reach a copy already downloaded.** It stops the next
open, the next download and the next sync; it deletes the recipient's
annotations on the document; and it cannot touch a file on a disk this
deployment does not own.

That is why `canDownload` is false by default, asked for per share, and stated
in `remove-access-dialog.tsx` before the tap rather than discovered afterwards —
and why the revoked state on the share detail screen says it in plain words. A
dialog that said "remove access" and meant something narrower would be the one
place this feature lied.

### Deleting an account is a chain, not a mutation

`sign-out-action.tsx` said this existed long before it did. It exists now, in
`convex/account.ts`, and the shape is the interesting part.

**It cannot be one mutation.** An account is every row somebody has written:
documents, page text, annotations, shares in both directions, groups, events. A
Convex mutation has a one-second budget and a read limit, and a reader with four
thousand annotations exceeds both. The public mutation does two small things and
schedules a chain of bounded internal mutations, each a transaction that either
finishes its phase or reschedules itself.

**The account is unreachable from the first step, not the last.** `subject` is
the column `findUser` matches the Google token against, so it is overwritten
with `deleted:<id>` — a value a Google `sub` cannot collide with — and the
handle, address, name and photo go at the same moment. The reader is signed out
of an account that no longer answers to their token while the rows behind it are
still being removed. A half-deleted account that is still findable by strangers
is the state this rules out.

**Documents go through `Library.removeDocument`.** It already removes the
outline, the job, the page text, the bookmarks, every annotation including other
people's, every share on the document and both R2 objects. A second cascade
written here would be a second thing to keep correct, and the one that got
forgotten would be the one leaving a stranger's notes in the database.

**`documentShares.by_creator` exists for this.** A reshare made by this account
of somebody else's document is reachable by neither `by_owner_and_updated` nor
`by_recipient_*`, so without that index deleting an account would leave grants
behind on documents it never owned.

**The cascade takes a user id and so it is `internalMutation`.** That argument
shape is exactly what must never be reachable from a client; the public
`deleteAccount` takes no arguments at all and deletes whoever is calling.

### The profile has no photo URL field

An account can set a display name and can turn its Google photo off. It cannot
supply a photo URL, and the omission is deliberate: a string the reader supplies
and this deployment then renders on _other people's_ screens is a tracking pixel
with a profile around it — whoever controls that host learns the address and the
moment of everyone who opens a screen the reader appears on. It also buys
nothing, because the photo people expect is the one on the account they signed
in with.

Hiding is a decision made at the projection rather than by clearing the column.
`pictureUrl` keeps holding Google's claim, because the claim is re-read on every
sign-in and a cleared field would come straight back on the next launch;
`photoOf` is what both `toPublicProfile` functions call, so one flag covers
every screen anybody sees them on. `nameIsCustom` does the same job for the
name, and without it a reader's edit would silently disappear at the next
launch.
