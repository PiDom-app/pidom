# Version 1.0.6 branch notes

## Version metadata

The mobile Expo configuration, root package, desktop package, and both npm
lockfiles now declare version `1.0.6`. Expo uses the `appVersion` runtime policy,
so the mobile update runtime changes with the app version.

## Document import and reading

- Desktop imports carry their detected document kind through staging, local
  library entries, reader opening, and cloud synchronization.
- Local-only document identifiers are kept out of Convex document queries and
  reader mutations while imports are waiting to synchronize.
- Storage paths and download validation support non-PDF documents. Shared format
  helpers resolve stable document kinds and image MIME metadata.
- Windows launch arguments and Open With registration recognize supported
  document extensions.
- Import, download, and settings messages describe supported documents rather
  than assuming every file is a PDF.

## Backend and shared synchronization

- Canonical storage keys use document-specific extensions, with PDF as the
  fallback for legacy metadata.
- Upload attachment checks the expected storage key and content type for the
  document kind.
- R2 metadata synchronization checks ownership against format-specific keys.
- PDF extraction and probing are restricted to PDF documents.
- Shared mobile synchronization sends detected document-kind metadata. This
  does not make the mobile import or reader flow fully multi-format.
- Regression coverage includes DOCX import metadata and TXT upload attachment
  without PDF extraction.

## Included workspace work

The branch also preserves the previously untracked editor route at
`botcoder254-verbose-guacamole/desktop/src/renderer/routes/editor.$documentId.tsx`,
as part of the request to commit all current changes. It is outside the active
desktop app and has unresolved imports in the root typecheck.

The pre-push formatter now runs Prettier's JavaScript entry point with Node,
matching the pre-commit hook and avoiding the Unix executable shim on Windows.

## Verification and remaining work

Checks run before the version-only change:

- Root Vitest suite: 153 tests passed.
- Desktop Node test suite: 24 tests passed.
- Targeted backend suite: 64 tests passed (included in the root test coverage).
- Targeted Prettier checks passed.
- Git whitespace checks passed.

After the version change, Prettier passed for the files changed relative to the
branch base. The version declarations were also verified in the release commit.

Full typechecking and packaged desktop smoke testing remain incomplete. Earlier
checks encountered unresolved imports in the preserved editor route, desktop
database typing errors, and a Vite/plugin peer-dependency installation conflict.

The Convex backend has not been deployed from this workspace. Deployment
configuration and a real TXT/DOCX import against the updated backend are still
needed to verify the reported live validator error is resolved. Pushing this
branch does not by itself publish installers or deploy Convex.
