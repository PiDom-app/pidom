# Architecture

How a document gets from a file picker to a second phone, and what owns which
half of it along the way.

## Where a PDF lives

**Convex owns metadata, the device owns the file.** Rendering the library never
touches a PDF, which is what makes a cold launch fast and a second device
legible.

```
document picker → %PDF- header check → staging → probe (cover, pages, contents)
                → convex row (mints the id) → Documents/library/<profile>/<id>.pdf
                                            → R2 <ownerId>/<id>.pdf, if asked for
                                            → text extraction, if it went to R2
```

The local filename is the Convex document id. The name the reader picked the
file under never becomes a path segment, so a PDF called
`../../../shared_prefs/auth.xml` is a title and nothing else — traversal and
collision are closed by construction rather than by sanitising a hostile string.
That is also why the row is written before the file moves: the row's id is the
filename. If the move fails the row is deleted again, because a row with no file
reads as permanently "not on this device" with nothing the reader can do.

`storageKey` says a document *can* be fetched. It does not say it has been, and
no field says that — a row cannot know what is on a given phone's disk, and a
stale flag would put a wrong badge on the one screen whose job is to say what
opens offline. There is no `file://` URI and no download state.
`src/features/library/local/` scans the directory once per authenticated launch
and `src/stores/local-library-store.ts` holds the answer, so a rail of twelve
tiles reads it synchronously instead of putting twelve `File.exists` calls on
the render path.

**The directory is the profile id**, and that is not tidiness. Home reconciles
local files against what the server says the caller owns, deleting any whose row
is gone — otherwise a document deleted on another phone leaves its file here
forever. In one shared directory that reconciliation is a data-loss bug: sign in
as somebody else and it deletes the first reader's library, because no account
owns another's documents. A segment per profile makes that impossible rather
than careful.

So a document is in one of four places, and the tile draws all four: **on this
device**, **in your account** (a tap fetches it), **arriving**, or **on this
phone only**. The last is the one worth naming — it is where losing the phone
loses the document.

## Syncing

Files live in **Cloudflare R2**, through `@convex-dev/r2`. Convex's own file
storage cannot serve them: an HTTP action response is capped at 20 MiB on every
plan, HTTP actions run in the Convex runtime's 64 MiB of memory, and
`ctx.storage.getUrl()` hands out a URL that is permanent and unauthenticated —
their docs say the only way to revoke one is to delete the file. A 100 MB
document had to come from somewhere else, and R2 is where Convex points.

It also costs less. R2's free tier is 10 GB with **no egress charge at all**,
against Convex's 1 GB of storage and 1 GB/month of egress — so a second phone
syncing a library stops eating a monthly allowance.

**Uploading is per document**, not automatic, and capped at 100 MB. That cap is
a product decision now rather than a platform one, and the import screen says so
before the reader commits.

**Downloads use a signed URL that expires in five minutes.** The ownership check
runs when the URL is minted rather than on the request that moves the bytes,
which is the trade R2 buys — weaker than the authenticated route this replaced,
far stronger than a permanent public link. Five rather than the component's
default of fifteen: a download starts immediately, and the window has no reason
to be wider than the act.

**Object keys never cross the wire.** They are `<ownerId>/<documentId>.pdf`,
minted in `library.uploadUrl` from ids the caller cannot bend — the component's
own `generateUploadUrl` refuses a custom key because, as its docs say, you do
not want the client naming your objects. `toPublicDocument` exposes `isSynced`
and `hasCover` as booleans and nothing else: a key is a guessable string in a
way a Convex id is not.

The upload is three requests — `uploadUrl`, a PUT straight to R2, `attachUpload`
— and the third one is why. Nothing in the middle request is under the server's
control: not the size, not the content type, not whether it is a PDF. So
`attachUpload` recomputes the key, reads the object's size, type and digest back
out of R2's metadata, and **deletes anything that fails rather than linking it**.
A rejected upload that stayed would be billed storage the reader cannot see or
remove.

For the same reason an object whose `attachUpload` never arrived — the app was
killed mid-upload — is referenced by nothing, and neither R2 nor Convex collects
it. That is one of the four things the nightly job sweeps; see **Maintenance**.

## Offline

The empty state promises documents are "readable with no connection", so the
library that finds them has to be too. That used to be a **cache**: the last
home payload in `AsyncStorage`, rendered under an "as of" line when the socket
was down. A cache is the wrong shape for this. It answers one screen's question,
goes stale, has nothing to say about a document the reader imported while it was
the only thing available, and cannot be written to at all.

So the device has its own database. `src/features/library/local/` is an
`expo-sqlite` database per profile — ten tables, versioned through
`PRAGMA user_version`, encrypted with SQLCipher under a 256-bit key that
`expo-secure-store` holds — and it is the **first** source for every ordinary
read. Home, the all-library screen, a collection, the reader, the navigator and
find-in-document all read SQLite. None of them waits on Convex, and none of them
behaves differently with the radio off.

That is the difference between offline-capable and offline-first, and it is
worth being precise about which one this is: the network can disappear before
the reader opens Home, while they are on page 438, while they are adding a
bookmark, or immediately after they write a note, and not one of those actions
needs it back.

The account is what the device converges **with**, afterwards. Every local write
also enqueues a row in `syncQueue`, and `src/features/library/sync/` drains it
when there is a connection, then reads the account back and makes the device
agree — including working out what another phone deleted, which it does by
noticing an absence rather than by reading a tombstone.

`documentFiles` is the table that has no counterpart in the account, and
deliberately: `state` is `missing`, `downloading`, `available`, `corrupt`,
`deleting` or `deleted`, and only the device can honestly say which. A field on
the server saying a document is "downloaded" would be a stale flag on the one
screen whose job is to say what opens offline. `/storage` is where a reader
reads that table back — what the library takes up here, largest first, and
whether removing any given document costs a download or destroys the only copy.

The two questions a screen still asks about the network are separate.
`useConvexConnectionState` answers whether the backend is reachable; `NetInfo`
answers whether there is a network at all. An interface can be up while Convex
is not — a captive portal, a DNS failure, an incident — and telling a reader on
good wifi to check their connection sends them to fix something that is not
broken.

**Import is no longer the exception.** It used to be the one action that could
not be queued, because the server minted the id and the id is the filename. The
device mints it now — `repository/ids.ts`, a dash-stripped UUID, in the shape a
Convex id takes — so a PDF imported in aeroplane mode is a real document in a
real library, and `importDocument` carries that `localId` so a retry after a
dropped reply returns the same row instead of making a second one.

The upload itself is **not** awaited. Committing an import writes the row, moves
the file and the cover, and closes the screen; the upload runs on with the tile
drawing its progress from `src/stores/transfer-store.ts`. Twenty megabytes over
slow data is a minute nobody should spend on a screen whose Cancel no longer
means anything.

## Reading

`src/features/reader/` is a full-bleed route above the library, and it is where
somebody actually spends their time. The architecture is one boundary: React
Native owns the controls, the navigation, the reading state and the responsive
layout; `react-native-pdf` owns page rendering, document loading, zoom and
panning. Nothing crosses it. In particular there is **no application-level zoom**
— the renderer's pinch and double-tap are native, and a second engine layered
over them is two gesture recognisers competing for the same fingers.

It opens `Documents/library/<profile>/<document>.pdf` and nothing else. Convex
is never asked for bytes to open a document, which is what lets a 600-page
textbook open in airplane mode; the account supplies the metadata around it —
the title, the saved position, whether there is an outline, whether there is a
copy to fall back on.

### Three modes

`continuous` and `single` are one renderer with different props: vertical and
unpaged, fit to width, versus horizontal and paged, whole page on screen.
`spread` is **two** renderers, because `react-native-pdf` has no two-page layout
and `enablePaging` plus `horizontal` does not compose into one. Two instances is
the honest implementation, and its cost — a second copy of the document held
open — is why the mode is offered only above 900 points of width.

Width, not orientation. Expo's documentation is explicit that from iOS 27 a
supported orientation is a preference rather than a requirement for a resizable
app, so a layout keyed on "am I landscape" is wrong in a split view and on a
foldable. `useWindowDimensions` reports the space actually available.

The chrome's own overlays are **one value, not a boolean each**. There used to
be five flags and nothing coordinating them, so two sheets could be open at once
and every hand-off between them had to be remembered as a pair of `setState`
calls. `activeOverlay` makes that impossible instead of careful. The password
prompt, the link prompt, the selection bar and the document's action sheet stay
outside it: those are opened by the renderer or by the library, and can
legitimately sit over one of the others.

**Text selection is iOS only, and that is the renderer rather than a bug here.**
`react-native-pdf`'s Android view manager accepts sixteen props and
`enableTextSelection` is not among them; there is no selection code in its
Android sources at all, so the prop is silently ignored and a long press on a
page does nothing. The iOS side is PDFKit and does support it. That is why
keeping a passage is an iOS path and writing a note is on both — the capability
does not exist on one platform, and a feature reachable on half the installs
would be worse than one that is honest about where the words come from.

A mode change **remounts** the canvas rather than changing props on it. Layout
props reach the native view directly, and an Android `PdfView` is not built to
reflow from scrolling to paged in place; a reload on an explicit menu tap is the
cheaper thing to be wrong about.

### Where the position goes

```
onPageChanged ─► component state             immediately, it draws the bar
              ─► reader store (AsyncStorage)  immediately, it survives a crash
              ─► api.library.recordProgress   debounced 15s, and on the way out
```

The middle line is what makes a force-quit survivable. Position used to land
only on unmount and on backgrounding, which is right for the exits that are
exits and loses the chapter for the one that is not — an OOM kill, a battery, a
swipe-up from the app switcher. The store write is cheap enough to do on every
page and is read back *before* Convex answers, so reopening lands on the right
page instantly and offline.

The last line stays expensive and therefore stays rare: fifteen seconds of
quiet, a jump of ten pages or more, backgrounding, or leaving. `recordProgress`
is rate limited now that it is the most frequent mutation in the app.

`readingMode` rides along on the same row, because how a document reads is a
property of the document. Fit policy, zoom and the wake lock do not — those
describe a screen in a room, and a phone and a tablet want different answers
without either being wrong. They stay in `pidom.reader` on the device.

### Finding, marking, selecting

**Find works without leaving the page.** The reader's search button used to push
to `/search`, which meant leaving a document to look inside it and coming back
through a `?page=` deep link. It now opens a bar over the top chrome. There is
no new backend behind it: the page text is already extracted into
`documentPages` for every synced document and already mirrored into this phone's
FTS5 database, and both were already scoped by document id — so finding inside
one document is the search that existed, asked a narrower question, and it
answers with no connection. Hits are ordered by page rather than by relevance,
because stepping forwards and backwards through a book by relevance is not
something a reader can follow.

**Bookmarks are a table**, not an array on `documents`: an unbounded list inside
a row grows into the 1 MB limit and rewrites the whole row on every append, and
this one is written far more often than the row it belongs to. `ownerId` is
denormalised as on `collectionDocuments`, so a bookmark is owner-checked without
fetching the document behind it. Adding a marked page renames it rather than
duplicating it, and removing an unmarked one is silent, so the toggle in the
chrome cannot produce a list with duplicates in it. `label` had been in the
schema and honoured by `addBookmark` from the start while nothing ever sent one
— the chrome's control is a toggle, which has no name to give — so every row
read `Page 142` however deliberately somebody had stopped there. A long press on
a row names it now.

**Notes are what an annotation can be on this renderer.** `react-native-pdf`
reports the *text* of a selection and no geometry: `onTextSelectionChange` hands
back a string, and `onPageSingleTap` hands back `MotionEvent.getX()`, which is
where a finger touched the view rather than where the words sit on the page and
stops meaning anything the moment somebody scrolls. There is no page-rect API
and no overlay hook, so **a highlight cannot be painted where the passage is**,
and nothing here pretends otherwise — the mark is a rule down the left of a row
in a list, which is somewhere it can be accurate. A `documentAnnotations` row is
a page, a kind, the document's words, and the reader's. `rect` is in the schema,
optional and unwritten, so the day a renderer reports quads is a client change
rather than a migration over everybody's notes.

The renderer's selection is iOS-only — the Android view manager has no selection
code at all — so the selection bar's **Keep** and **Note** exist on one platform
and the capability does not: the reader's overflow offers *Write a note* on both,
anchored to the page instead of to words. Keeping a passage carries a Convex
optimistic update, which bookmarks do not: a bookmark's feedback is an icon that
fills before a thumb leaves the glass, while a kept passage puts a row in a list
the reader is about to open.

**Contents, Bookmarks, Notes and Pages share one screen**, because they answer
the same question — where in this document do I want to be. It used to be gated
on the document declaring an outline, on both of its entry points, and most PDFs
declare none: a reader could mark a page from the toolbar, watch the icon fill,
and have no way left to reach the list. Contents is one of four segments now,
and an outline the file does not have is an empty state rather than a locked
door.

**A screen and not a sheet**, and that was learned on a device. It was an
`Actionsheet`, which is as tall as its content — so moving from Contents (355
rows) to Bookmarks (one row) shrank it by two thirds, the segmented control
moved down with it, and the next tap landed on the backdrop and dismissed the
whole thing. A control must not hang off a box whose height is the reader's
data. Pushing costs nothing here: the stack keeps the reader mounted
underneath, so going back is not reopening a 400-page document, and a screen
cannot return a value so the chosen page is left in `reader-store` and picked up
on focus.

Writing a note is a screen for the same reason plus one: a dialog holding a
keyboard on a phone is a box with four visible lines in it, and a note is prose.
What is left as a sheet is the short fixed lists — a page number, three reading
modes, four settings — where the height never surprises anybody.

**Pages is the document as pictures**, three columns, and the cells are **images
rather than renderers**. They were renderers first, one `<Pdf singlePage>` per
cell, which is nine native document handles over the same file for one screen:
measured on a device that took eight seconds to paint and every scroll paid it
again. A page is now rendered once by a single off-screen viewer into
`library/<profile>/pages/<document>/<n>.jpg` and read back with `expo-image`, so
the same screen fills in about two seconds and the second visit is immediate.
Only what is on screen is ever rendered, so a 433-page book costs the dozen
pages somebody actually looked at. Past `THUMBNAIL_PAGE_MAX` the segment is
absent rather than slow, and the scrubber still reaches any page in one drag.

**Selection was already on.** `enableTextSelection` defaults to `true` in
`react-native-pdf`, so an iOS reader could select text and reach the system menu
while nothing here knew; `onTextSelectionChange` was firing into a default
no-op. It now raises Copy and Find. iOS only, because the renderer's selection
is — on Android there is no bar rather than a button that cannot work.

**The page tint is a layer, not an inversion.** `react-native-pdf` cannot invert
a page, and a dark reading treatment is a different feature from a dark
application. So the switch is phrased the right way round: *Follow the document*
is on by default and means pages render as they were authored, which is what a
PDF reader owes a PDF. Turning it off puts a dim or warm overlay between the
page and the chrome — the controls stay at full contrast while the document
dims.

### One way to move the page

Contents entries, find results, the scrubber, the page field, a bookmark, a
kept passage, a thumbnail and a screen reader's swipe-to-adjust all call
`goToLocation` in `reader-commands.ts` — `goToPage` is that function with a bare
number, kept for the callers that only have one. The argument is a
`DocumentLocation`, which is a page today and has room for a rectangle, so a
renderer that one day reports where on a page something is becomes a change to
the two places that produce locations rather than to every place that consumes
one.
That is also the one place a page change is announced to assistive technology,
so one call covers every caller. Five features talking to
`pdfRef.setPage` directly is five places to get clamping and spread-pairing
right. The scrubber in particular does **not** move the document during a drag,
only on release: asking the renderer to turn to each page under a moving finger
is asking it to render three hundred pages nobody will look at.

### What a document can do to the app

A PDF is a file somebody else wrote, and two of `react-native-pdf`'s defaults
are not defaults this app should inherit silently.

`trustAllCerts` defaults to **`true`**, which turns certificate validation off.
Pidom only ever passes a `file://` URI so nothing is fetched — which is exactly
why it is set to `false` on every mount, including the probe and both panes of a
spread: the day somebody passes a URL, the safe behaviour should already be
there rather than needing to be remembered.

`enableAnnotationRendering` also defaults to `true` and is deliberately left on,
written out rather than inherited. Links are content and a document with dead
cross-references is a worse document. What makes that safe is `onPressLink`,
which was previously unset — so links did nothing, safely by accident.
`open-pdf-link.ts` now parses the URL and refuses everything that is not
`https:`. Not a blocklist of `javascript:` and `data:`, because a blocklist is a
list of the attacks somebody thought of; an allowlist of one scheme also covers
`file:` and `content:`, which are the interesting ones given this app registers
itself as a handler for both. What survives that is shown to the reader host
first, and only opened if they agree.

A password for an encrypted PDF goes to `expo-secure-store` and nowhere else —
not to Convex, not to the document row, not to the log, not even its length.
`SECURITY.md` reserved that dependency for this and nothing had needed it until
now.

This is what Continue Reading, the progress bars and Finished were built to be
fed by. Before it existed `library.recordProgress` was a public function with no
caller and three of the six home rails could never hold anything.

## Processing

One `<Pdf>` mount answers three questions about a file, and until recently it
answered one and threw the other two away. `onLoadComplete` hands back the page
count **and** `tableContents` on the same load the cover is snapshotted from —
so the table of contents in every bookmarked PDF was sitting there, free, behind
an ignored fourth argument.

`src/features/library/components/document-probe.tsx` is what reads it. It is
mounted rather than called, because rendering a native view is what it does, and
it sits off-screen — not hidden, since `display: none` and zero opacity both
give Android nothing to snapshot. There is no library that turns a PDF page into
an image on React Native 0.86: the two purpose-built ones were last published in
November 2023 and September 2024, neither declaring New Architecture support,
and 0.86 is bridgeless-only. So the page is rendered by the viewer that is
already here and still maintained (`react-native-pdf` 7.0.5, August 2026, ships
`codegenConfig`), snapshotted with `react-native-view-shot`, and downscaled with
`expo-image-manipulator`.

**The row is written before the probe runs**, because the row's id is the
filename. So a document is in the library and openable while its cover is still
being made, and `documents.processing` is the field that says which:

```
probing → ready      cover and page count both landed
        → partial    the count landed, the snapshot did not
        → failed     the viewer could not read the file at all
```

`partial` and `failed` exist because a cover that never rendered used to be
indistinguishable from a document that never had one, with nothing the reader
could do about either. Now the action sheet offers **Reprocess**, which re-runs
the probe against the local file.

**`probing` is a state with an exit**, and that is load-bearing rather than
tidy. Add to library is live the moment a file is picked and the probe takes a
second or two, so a reader who taps promptly commits before it reports — and the
import screen closes, taking the probe with it. That used to write the document
as `failed`, permanently, on the strength of a page count that had not arrived
yet; the faster the reader, the worse it behaved.

Now the row lands as `probing` and `usePendingProbe` on the home screen picks it
up: one document at a time, oldest first, only those whose file is on this
device. One at a time because a probe is a native view rendering a page, and
four mounted at once on a cold launch is the frame budget spent on covers nobody
is looking at yet. The same loop recovers a probe the OS killed by backgrounding
the app mid-import.

**Two files are refused outright**, both before anything is written. A file
whose first five bytes are not `%PDF-` never gets staged — `pickPdf` used to
accept anything whose MIME type or extension claimed to be a PDF, and Android
file managers report `application/octet-stream` often enough that neither could
be trusted, so a renamed `.docx` imported cleanly and opened to nothing. And a
PDF with a password ends at the probe: `onError` used to be logged at debug and
reported as "no cover", so an encrypted document got a tinted cover, a row, and
a blank reader with no explanation.

The same open that reads the header also takes a **fingerprint** —
`<byteSize>-<sha256 of the first and last 64 KB and the size>` — so importing
the same file twice says so before it makes a second copy. Deliberately not a
digest of the whole file: `expo-crypto` hashes a buffer with no streaming API,
and holding a 100 MB textbook in memory is a crash on the phones this is for.
The field is called `fingerprint` for that reason; `contentHash` beside it is
R2's real digest of the copy in the account.

The tinted cover is still the fallback: a document imported before any of this
existed, one whose render failed, or one from another device whose cover has not
been fetched yet. It is a page-shaped surface with the title set in type, tinted
by

```
hue = (282 + hash(id) % 12 × 30) mod 360
```

Twelve buckets thirty degrees apart, anchored on the brand purple's hue, so the
same document is the same colour on every device for as long as it exists. The
table is baked to hex in `src/features/library/components/cover-tints.ts`,
because React Native's colour parser does not read `oklch()`.

## Searching inside documents

The device can render a page and count pages; it cannot search a library. That
needs the text, and the only copy of a document the server can see is the one in
R2 — so **extraction runs over synced documents and nowhere else**, and
`documents.textStatus` is optional for exactly that reason. A local-only
document has no text status because nothing could have given it one, and the
search screen says so rather than leaving a reader to wonder where their book
went.

It is a **Convex Workflow** (`convex/workflows/document.ts`), which is the one
durable multi-step flow in the app. Four steps with four different failure
modes: a fetch that can 404, a parse that can hang, a long run of writes, and a
finalisation that must happen exactly once. A scheduled action that died halfway
would leave a document `extracting` forever with half its pages in the table and
nothing to notice; a workflow survives a server restart, retries the step that
failed rather than the whole run, and publishes a status the Details sheet
subscribes to.

The parse itself is a **Node action** (`convex/node/extract.ts`) running
`unpdf`, which ships Mozilla's PDF.js built for serverless runtimes. Node
because that build wants built-ins the Convex runtime does not have, and the
trade is worth naming: 512 MiB and ten minutes, against the Convex runtime's
64 MiB and thirty.

**The text never travels through a workflow step.** The component caps a run's
total step arguments and returns at 1 MB, and a 600-page book is far past it —
so the action writes `documentPages` fifty at a time from inside itself and
returns counts. That single constraint is what the whole pipeline is shaped
around.

Everything in that action is parsing a file Pidom did not write, so it is
bounded on every axis it can be: 32 MB, 2,000 pages, 8 KB of text per page, and
a two-minute timeout the parse cannot outlive — unpdf's serverless build parses
on the event loop with no worker to kill. Terminal answers throw
`NonRetryableError` rather than burning three attempts to reach the same
conclusion.

Then `documentPages` carries a search index filtered on `ownerId`, which is
load-bearing in the way it is on `search_title`: a search index has no implicit
scope. A hit is a page, so it names one, and tapping it opens the reader there.

## Searching with no connection

There are two indexes and they answer different questions. Convex's is reactive,
cross-device and always current. The device's own is on the phone and works in
aeroplane mode. The search screen picks between them by whether the backend is
answering, and says which one did.

The local one is `expo-sqlite` with an FTS5 virtual table, one database per
profile for the reason the library directory is per profile — these are the
words of somebody's documents. FTS5 is compiled in on both platforms unless
`expo.sqlite.enableFTS` is set to `false`, which nothing here sets; the
`CREATE VIRTUAL TABLE` at open is still the proof rather than the assumption,
and a build without it disables local search instead of failing to launch.

**It is a mirror, not a second extractor.** `react-native-pdf` has no text API,
so the device physically cannot read a PDF's words — the only text in the system
is what the Node action read out of the R2 copy. So a document is searchable
offline exactly when it has been synced, extracted, and then pulled down here
once by `useTextMirror`, which runs on the same quiet footing as
`use-cover-sync.ts`: sequential, once per document, and only for documents whose
file is already on this device. Mirroring a document that is not here would spend
a reader's data on a book they would still have to download.

The text goes when the file goes. `deleteDocument` and `removeDownload` both
call `forgetLocally`, because a delete that leaves the reader's document content
in a database on their phone is a delete that did not happen.

## Opening a PDF from another app

`app.json` registers Pidom as a PDF handler: an Android `intentFilters` entry for
`VIEW` on `application/pdf`, and iOS `CFBundleDocumentTypes` with
`LSSupportsOpeningDocumentsInPlace`. That is the "Open with" and "Open in" entry
from Files, Drive, Mail and a browser download.

**Android's share sheet is not covered**, and it is worth knowing rather than
discovering: `ACTION_SEND` delivers the file as an `EXTRA_STREAM` extra rather
than as the intent's data URI, and `expo-linking` surfaces the URI only. Reading
that extra needs a native module Expo does not ship.

The URL arrives as `content://` on Android, which the `expo-file-system` `File`
class cannot open — the same problem `copyToCacheDirectory` solves for the
picker. `react-native-blob-util` is already here for the reader and can read a
content URI, so it copies the file into the same staging directory the picker
uses under a UUID. Everything after that is the existing import path, header
check included: another app's idea of a PDF is exactly as trustworthy as a
filename.

## Maintenance

Everything the nightly cron repairs is the same shape of failure: something that
accumulates because nothing else will ever collect it.

An R2 object whose `attachUpload` never arrived — the app was killed mid-upload
— is referenced by nothing, visible in no screen, and billed forever. An
extraction whose process went away leaves a document `extracting` for good. Page
text belonging to a document that is no longer synced is the reader's own
content outliving their decision to remove it. And the workflow component keeps
a completed run's step journal until something calls `cleanup`, which is one per
document per sync.

The page-text collector is worth naming, because the first version of it did not
work. It scanned the head of `documentPages` looking for rows whose document was
gone — which reads the *oldest* pages in the deployment, almost always a document
that is perfectly fine. It swept nothing, every night, while orphaned text sat
further down the table. Orphans are now **recorded** rather than searched for:
`detachUpload` and `removeDocument` delete as much as a mutation's read budget
allows and enqueue whatever they could not reach, and the job drains that queue.

`convex/crons.ts` runs one job that queues four into a **Workpool**
(`convex/maintenance.ts`). That is the distinction against the workflow next
door: these four are independent, unordered and idempotent, so what they want is
a bounded queue with backoff rather than a resumable journal. Its own pool
rather than the workflow's, so a night of maintenance cannot sit in front of a
reader's import — the free plan allows 20 parallel across every pool in the
deployment, and these two take 4 and 2.

The orphan sweep asks whether an object is referenced **one object at a time**.
It used to diff two truncated pages — the first two thousand objects against the
oldest two thousand document rows in the deployment — and delete the difference,
which made every object belonging to a newer row an orphan by construction. A
candidate list can be paged over several nights; an allowlist cannot. See
`docs/security.md`.

## Rate limits

`convex/model/rateLimits.ts` puts a per-account token bucket in front of the
four writes that cost money or work: `importDocument`, `uploadUrl`,
`downloadUrl`, `reprocess`, and collection creation beside them. `uploadUrl` is
the one that mattered most — it mints a signed PUT against a bucket Pidom is
billed for, and nothing but authentication stood in front of it.

Buckets rather than fixed windows: a reader who adds nine books in one evening
is doing something real, and a fixed window would refuse the tenth for no reason
a person could understand.

Reads are absent, search included, and that is a limitation rather than a
choice — spending a token is a write, and a query cannot write. Declaring a
limit nothing enforces would be worse than declaring none.

## Sharing

```
owner picks people  →  documentShares row  →  recipient accepts  →  signed URL
                                                                        ↓
                       reconcile ← Convex ← outbox            local file + row
```

A shared document is **one row with one owner** and a grant on top of it. The
recipient's device ends up with an ordinary `documents` row — `ownedByMe` at 0,
`shareId` naming the grant — so it opens offline, takes notes, and appears in
the library like anything else. Everything specific to sharing is the grant.

**Two tables and one resolution.** `documentShares` names either a person or a
group; `groupMembers` says who is in the group. Access is resolved on every read
through `convex/model/access.ts`, never cached — so a person leaving a group of
six that shares four documents is one row deleted, not twenty-four, and nothing
has to remember to run.

**The device holds a mirror.** `shares`, `groupsLocal`, `groupMembersLocal` and
`shareEvents` are written by three new reconcile passes in `sync/engine.ts`. A
share row carries the document's title, size and page count, which is why the
inbox is legible with no connection and before a single byte has been fetched.

**Writes go through the outbox like everything else**, with two exceptions that
are deliberate:

- **Group membership is never queued.** Adding somebody changes what *they* can
  open, and a device that invented memberships offline would be deciding who can
  read another person's documents with nothing to check against. Refused with a
  sentence instead.
- **Downloading is not queued**, because it is a network act by definition.

A share made in a tunnel is written, queued and delivered on reconnect. What it
cannot do is take effect — nobody is told anything until the queue drains, and
the share screen says exactly that rather than letting the sender assume.

### Fan-out

Creating a share commits the grant and the event, then hands the network off. A
person's share dispatches one push through the `notifications` workpool. A
group's starts `workflows/share.ts`, which pages members at
`SHARE_FANOUT_BATCH` — **nothing there grants anything**, because a group share
is already one row; what is left is the part that has to reach two hundred
people one at a time.

Expo's send call returns a ticket, and whether the notification arrived is only
knowable from a receipt fetched about fifteen minutes later. `push.ts` records
tickets, polls receipts, and deletes a token on `DeviceNotRegistered` — which is
the only thing that ever retires a dead token. Without that half, a reinstalled
phone accumulates tokens nobody ever clears.

### Presence

`@convex-dev/presence` in rooms named `document:<id>` and `group:<id>`. Entered
only for a document that is actually shared, either way round — presence on a
private document is a mutation every ten seconds telling an empty room that one
person is in it, and nearly every document is private.

Ephemeral by construction: a heartbeat and a timeout, run by one
deployment-wide worker rather than by every client polling. There is no
`lastSeen` column and no "active 4 minutes ago", because the component does not
know that and a number invented to fill the space is a number somebody would
believe.

## Layout

```
convex/          schema, OIDC config, and the public function surface
  convex.config.ts  R2, Workflow, Workpool, Rate Limiter
  r2.ts          the bucket, and the one function the client may call on it
  crons.ts       one nightly job, which queues four
  maintenance.ts the workpool those four run in
  workflows/     the durable extraction flow, and how one is started
  node/          the one "use node" action: pdf.js over a synced document
  model/         all server logic; public functions are thin wrappers
src/
  app/           expo-router routes and nothing else
  features/      one folder per capability — auth, account, library
    library/
      components/  the screen, and the one tile every surface draws
      data/        hooks the screens read, over the local database first and
                   Convex second, plus the wire types and error codes
      local/       the device half, and the source of truth for reading: the
                   SQLCipher database and its migrations, a repository per
                   entity, the outbox table, paths, the picker, validation,
                   transfers, free space, and the phone's own FTS5 index
      sync/        the outbox drained, the account read back, and what each
                   answer from it means for an operation
      import/      the import screen and the order its steps happen in
      all/         everything behind "View all"
      collection/  one collection
      search/      searching the words inside documents, not their titles
    reader/        the canvas the PDF renders on, the chrome over it, the
                   sheets, the one goToPage they all call, and the place kept
  providers/     the provider stack
  design/        global.css tokens, plus the mirror native APIs read
  components/
    ui/          gluestack primitives, vendored by the CLI
    brand/       the Pidom mark
  stores/        zustand, and only for state worth losing — theme, which
                 documents are on this device, what is transferring, how far
                 behind the account is, and the page the reader is on between
                 two writes to it. Anything durable is in SQLite.
  lib/           env, jwt, connectivity, logger
.design/         the design canvas: one .dc.html per artboard, and the
                 generator that writes them
```

A route file composes a screen out of `src/features/<capability>/` and holds no
logic of its own. The reader is `src/features/reader/` and a ten-line route; the
only thing it reaches outside itself for is deletion — removing a document has
to forget the page and the password with it, so `use-library-actions.ts` calls
both.
