# Architecture

How a document gets from a file picker to a second phone, and what owns which
half of it along the way.

## Where a PDF lives

**Convex owns metadata, the device owns the file.** Rendering the library never
touches a PDF, which is what makes a cold launch fast and a second device
legible.

```
document picker → convex row (mints the id) → Documents/library/<profile>/<id>.pdf
                                            → R2 <ownerId>/<id>.pdf, if asked for
```

The local filename is the Convex document id. The name the reader picked the
file under never becomes a path segment, so a PDF called
`../../../shared_prefs/auth.xml` is a title and nothing else — traversal and
collision are closed by construction rather than by sanitising a hostile string.
That is also why the row is written before the file moves: the row's id is the
filename. If the move fails the row is deleted again, because a row with no file
reads as permanently "not on this device" with nothing the reader can do.

`storageId` says a document *can* be fetched. It does not say it has been, and
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

For the same reason there is one cron. An object whose `attachUpload` never
arrived — the app was killed mid-upload — is referenced by nothing, and neither
R2 nor Convex collects it. `convex/crons.ts` sweeps those nightly.

## Offline

The empty state promises documents are "readable with no connection", so the
library that finds them has to be too. Convex keeps query results in memory and
has no on-device persistence — a cold launch in aeroplane mode leaves `useQuery`
at `undefined` forever — so `src/stores/library-cache-store.ts` keeps the last
home payload in `AsyncStorage`, scoped to a profile id, and the screen renders
it under a quiet "as of" line when the socket is down. Sign-out clears it: those
are titles the reader chose.

With no cache to fall back on the screen says so rather than spinning, and it
says one of two different things. `useConvexConnectionState` answers whether the
backend is reachable; `NetInfo` answers whether there is a network at all. An
interface can be up while Convex is not — a captive portal, a DNS failure, an
incident — and telling a reader on good wifi to check their connection sends
them to fix something that is not broken.

Import is the one action that cannot be queued: the server mints the id and the
id is the filename, so there is nothing to name the file until the round trip
returns. It refuses with a reason. Favourite, rename and delete name a document
that already exists, so Convex queueing them until it reconnects is exactly
right, and they are left alone.

The upload itself is **not** awaited. Committing an import writes the row, moves
the file and the cover, and closes the screen; the upload runs on with the tile
drawing its progress from `src/stores/transfer-store.ts`. Twenty megabytes over
slow data is a minute nobody should spend on a screen whose Cancel no longer
means anything.

## Reading

`src/features/reader/` is a full-bleed route above the library. Tapping a
document opens it; tapping the page toggles the controls.

**Position is written on the way out, not per page.** A mutation per swipe is a
write per swipe, replicated to every device the account owns, re-rendering rails
on all of them to move a bar on one. The page lives in local state while reading
and lands once — on unmount, and on the app going to the background, because
somebody who swipes up mid-chapter has still read to there. Both paths read
refs, since neither sees the render that set the state.

This is what Continue Reading, the progress bars and Finished were built to be
fed by. Before it existed `library.recordProgress` was a public function with no
caller and three of the six home rails could never hold anything.

## Covers

Import renders the real first page. There is no library that turns a PDF page
into an image on React Native 0.86 — the two purpose-built ones were last
published in November 2023 and September 2024, neither declaring New
Architecture support, and 0.86 is bridgeless-only. So the page is rendered by
the viewer that is already here and still maintained (`react-native-pdf` 7.0.5,
August 2026, ships `codegenConfig`), snapshotted with `react-native-view-shot`,
and downscaled with `expo-image-manipulator`. `onLoadComplete` hands back the
page count on the same load, which is the first point in the app's life where
that number is knowable.

`src/features/library/components/cover-renderer.tsx` is mounted rather than
called, because rendering a native view is what it does. It sits off-screen —
not hidden, since `display: none` and zero opacity both give Android nothing to
snapshot.

It renders from a **staged** copy of the picked file, not the picker's own. The
import screen renders a cover and, on commit, moves that PDF into the library;
against one shared path that is a race the reader wins by tapping Add promptly,
pulling the file out from under the view reading it. So the picked file moves
once into `Paths.cache/pidom-import/<uuid>.pdf` — a UUID, because a reader's
filename never becomes a path segment anywhere here — and everything downstream
works from a path this app controls. It also survives the system clearing the
picker's cache while somebody is still typing a title.

The tinted cover is now the fallback: a document imported before this existed,
one whose render failed, or one from another device whose cover has not been
fetched yet. It is a page-shaped surface with the title set in type, tinted by

```
hue = (282 + hash(id) % 12 × 30) mod 360
```

Twelve buckets thirty degrees apart, anchored on the brand purple's hue, so the
same document is the same colour on every device for as long as it exists. The
table is baked to hex in `src/features/library/components/cover-tints.ts`,
because React Native's colour parser does not read `oklch()`. `DocumentCover`
reads `thumbnailUri` first regardless, so a real rasteriser later changes one
file and nothing that calls it.

## Layout

```
convex/          schema, OIDC config, and the public function surface
  convex.config.ts  the R2 component
  r2.ts          the bucket, and the one function the client may call on it
  crons.ts       the nightly sweep for objects nothing points at
  model/         all server logic; public functions are thin wrappers
src/
  app/           expo-router routes and nothing else
  features/      one folder per capability — auth, account, library
    library/
      components/  the screen, and the one tile every surface draws
      data/        hooks over Convex, plus the wire types and error codes
      local/       the device half: paths, the picker, the move, transfers
      import/      the import screen and the order its steps happen in
      all/         everything behind "View all"
      collection/  one collection
    reader/        the document itself, and where the place is kept
  providers/     the provider stack
  design/        global.css tokens, plus the mirror native APIs read
  components/
    ui/          gluestack primitives, vendored by the CLI
    brand/       the Pidom mark
  stores/        zustand — theme, which documents are on this device, what is
                 transferring, and the offline copy of the library
  lib/           env, jwt, logger
.design/         the design canvas: one .dc.html per artboard, and the
                 generator that writes them
```

A route file composes a screen out of `src/features/<capability>/` and holds no
logic of its own. Adding the reader means adding `src/features/reader/` and a
route, and touching nothing else.
