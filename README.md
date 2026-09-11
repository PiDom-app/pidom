<div align="center">

<img src="assets/pidom-mark.svg" alt="Pidom" width="92" height="92">

# Pidom

**A private, offline-first PDF reader for people who move between devices.**

Pidom imports your PDFs, keeps your library usable without a connection, syncs
the documents you choose, and resumes your reading place wherever you sign in.

[![Expo SDK 57](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)](https://docs.expo.dev)
[![React Native 0.86](https://img.shields.io/badge/React%20Native-0.86-20232a?logo=react)](https://reactnative.dev)
[![Convex](https://img.shields.io/badge/Convex-backend-EE342F)](https://convex.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-6a59e8.svg)](LICENSE)

</div>

## Features

- Import PDFs from the system picker or Android's "Open with" sheet.
- Read offline from an encrypted on-device SQLite library.
- Sync selected documents up to 100 MB through Cloudflare R2 and signed URLs.
- Keep reading position, collections, favourites, notes, and bookmarks in sync.
- Search synced PDFs online or from the device's local FTS index.
- Share documents, manage access, and receive privacy-safe notifications.
- Read in continuous, single-page, or two-page spread layouts.

## Stack

| Area     | Technology                                                                |
| -------- | ------------------------------------------------------------------------- |
| App      | Expo SDK 57, React Native 0.86, Expo Router                               |
| UI       | gluestack-ui v5, NativeWind v5, Tailwind v4 tokens                        |
| Backend  | Convex with Workflow, Workpool, Rate Limiter, Presence, and Expo Push     |
| Auth     | Google Sign-In with Convex OIDC verification                              |
| Storage  | Cloudflare R2 for synced PDFs, `expo-file-system` for device-local copies |
| PDF/Text | `react-native-pdf`, `unpdf`, and `expo-sqlite` FTS5                       |

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

The core reader, library, import flow, offline storage, sync, sharing, search,
collections, notes, bookmarks, push registration, and Android release pipeline
are in place. Highlights and OCR for scanned documents are not built yet.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
and keep changes focused, tested, and small enough to review.

Security reports should follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Telvin Teum
