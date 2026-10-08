<div align="center">

<img src="assets/pidom-mark.svg" alt="Pidom" width="92" height="92">

# Pidom

**A private, offline-first document reader for people who move between devices.**

Pidom keeps your library usable without a connection, syncs the documents you
choose, and resumes your reading place wherever you sign in. PDF is the
production reader today; the document-format layer is designed to add
reflowable text, ebooks, office files, spreadsheets, presentations, and images
without changing the reader shell or its offline-first behavior.

[![Expo SDK 57](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)](https://docs.expo.dev)
[![React Native 0.86](https://img.shields.io/badge/React%20Native-0.86-20232a?logo=react)](https://reactnative.dev)
[![Convex](https://img.shields.io/badge/Convex-backend-EE342F)](https://convex.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-6a59e8.svg)](LICENSE)

</div>

## Features

- Import supported document formats from the desktop system picker, folder scan,
  drag-and-drop, or file association without changing the library UI.
- Read offline from an encrypted on-device SQLite library.
- Sync selected documents up to 100 MB through Cloudflare R2 and signed URLs.
- Keep reading position, collections, favourites, notes, and bookmarks in sync.
- Search supported text-bearing documents from the device's local FTS index.
- Share documents, manage access, and receive privacy-safe notifications.
- Keep the existing continuous, single-page, and two-page spread layouts for
  fixed-layout documents, while reflowable formats use the same reader chrome
  with format-appropriate pagination.

## Format support

Pidom uses explicit format capabilities instead of treating every file as a
PDF. This keeps the UI stable while making fidelity and platform limitations
visible. Multi-format import and rendering are desktop-only; the mobile app
continues to use its established PDF pipeline.

| Format family       | Capability status     | Current renderer                              | Layout contract                                   |
| ------------------- | --------------------- | --------------------------------------------- | ------------------------------------------------- |
| PDF                 | Production            | Mobile native PDF renderer and desktop PDF.js | Fixed layout preserved                            |
| TXT, Markdown, HTML | Implemented (desktop) | Bounded text, Markdown, and sanitized HTML    | Reflowable document surface                       |
| EPUB                | Implemented (desktop) | Bounded archive text extraction               | Reflowable; scripts and active content blocked    |
| DOC/DOCX, ODT, RTF  | Implemented (desktop) | Safe text/intermediate representation         | Semantic content; not pixel-perfect               |
| CSV, XLS/XLSX       | Implemented (desktop) | Bounded table/intermediate representation     | Structured cells; not a PDF page model            |
| PPT/PPTX            | Implemented (desktop) | Safe slide/text representation                | Extracted slide content; not full-fidelity slides |
| Images              | Implemented (desktop) | Main-process verified local image surface     | Pixel dimensions preserved                        |

The registry is intentionally shared by import, storage, and rendering. Every
desktop adapter declares its security policy, offline behavior, search
representation, and layout guarantee. Office formats are rendered as a safe
reading representation rather than promising office-suite pixel fidelity.

## Why Pidom

Pidom is different in the places that matter for a personal library:

- **Local first:** the device copy is the source of truth for opening and
  reading, so losing connectivity does not turn the library into a placeholder.
- **Selective sync:** cloud storage is opt-in per document rather than a
  requirement for every file.
- **Privacy-aware sharing:** access is resolved server-side, revocation and
  expiry are enforced, and signed URLs are short-lived.
- **One reading model:** mobile and desktop share the same account, metadata,
  progress, collections, and reader intent while keeping platform-native
  rendering where it is strongest.
- **Honest fidelity:** fixed-layout documents preserve their pages; reflowable
  formats reflow. Pidom does not silently promise that DOCX, EPUB, slides, and
  spreadsheets are interchangeable.

Pidom is not trying to replace a full office suite or a collaborative editor.
It is a focused, private reading library that can grow across document formats
without sacrificing offline access or making unsupported fidelity claims.

## Stack

| Area      | Technology                                                              |
| --------- | ----------------------------------------------------------------------- |
| App       | Expo SDK 57, React Native 0.86, Expo Router                             |
| UI        | gluestack-ui v5, NativeWind v5, Tailwind v4 tokens                      |
| Backend   | Convex with Workflow, Workpool, Rate Limiter, Presence, and Expo Push   |
| Auth      | Google Sign-In with Convex OIDC verification                            |
| Storage   | Cloudflare R2 for synced documents, local managed copies on each device |
| Documents | Capability registry with bounded desktop adapters and secure renderers  |
| PDF/Text  | `react-native-pdf`, `unpdf`, and `expo-sqlite` FTS5                     |

## Getting Started

Pidom uses native Google Sign-In and notification modules, so Expo Go is not
enough. Use a development build.

```bash
npm install
npx convex dev
npx expo prebuild --clean
npx expo run:android
```

For OAuth clients, Firebase files, Cloudflare R2, Convex env vars, and release
credentials, follow [docs/setup.md](docs/setup.md).

## Documentation

- [Setup](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Android releases](docs/release.md)
- [Design](docs/design.md)
- [Contributing](CONTRIBUTING.md)

## Project Status

The core PDF reader, desktop multi-format reader, library, import flow, offline
storage, sync, sharing, search, collections, notes, bookmarks, push
registration, and Android release pipeline are in place. Desktop format
adapters have fixture coverage for text, Markdown, HTML, EPUB, DOC/DOCX, ODT,
RTF, CSV/XLS/XLSX, PPT/PPTX, and images. OCR for scanned documents,
office-suite editing, pixel-perfect office rendering, conversion, and export
remain separate capabilities rather than being implied by filename recognition.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
and keep changes focused, tested, and small enough to review.

Security reports should follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Telvin Teum
