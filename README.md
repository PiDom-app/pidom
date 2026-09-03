<div align="center">

<img src="assets/images/icon.png" alt="" width="96" height="96">

# Pidom

**A personal PDF reader that keeps your place across every device you own.**

Import documents, organise them into collections, read offline, and pick up on
your phone where you left off on your tablet.

[![Expo SDK 57](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)](https://docs.expo.dev)
[![React Native 0.86](https://img.shields.io/badge/React%20Native-0.86-20232a?logo=react)](https://reactnative.dev)
[![Convex](https://img.shields.io/badge/Convex-backend-EE342F)](https://convex.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-6a59e8.svg)](LICENSE)

</div>

---

## Screens

<table>
<tr>
<td width="33%"><img src="docs/screens/home-dark.png" alt="Home, dark"></td>
<td width="33%"><img src="docs/screens/home-light.png" alt="Home, light"></td>
<td width="33%"><img src="docs/screens/all-library.png" alt="All library"></td>
</tr>
<tr>
<td align="center"><b>Home</b><br><sub>Rails of covers, no cards</sub></td>
<td align="center"><b>Light</b><br><sub>One token set, both themes</sub></td>
<td align="center"><b>All library</b><br><sub>Search, sort, filter</sub></td>
</tr>
</table>

<table>
<tr>
<td width="25%"><img src="docs/screens/reader.png" alt="Reader"></td>
<td width="25%"><img src="docs/screens/import.png" alt="Import"></td>
<td width="25%"><img src="docs/screens/document-actions.png" alt="Document actions"></td>
<td width="25%"><img src="docs/screens/collection.png" alt="A collection"></td>
</tr>
<tr>
<td align="center"><b>Reader</b><br><sub>Position saved on the way out</sub></td>
<td align="center"><b>Import</b><br><sub>Real cover, sync decision</sub></td>
<td align="center"><b>Actions</b><br><sub>Eleven, on long press</sub></td>
<td align="center"><b>Collections</b><br><sub>A relationship, not a copy</sub></td>
</tr>
</table>

<table>
<tr>
<td width="25%"><img src="docs/screens/empty.png" alt="Empty state"></td>
<td width="25%"><img src="docs/screens/loading.png" alt="Loading"></td>
<td width="25%"><img src="docs/screens/offline.png" alt="Offline"></td>
<td width="25%"><img src="docs/screens/account-menu.png" alt="Account menu"></td>
</tr>
<tr>
<td align="center"><b>Empty</b><br><sub>One action, no placeholder cards</sub></td>
<td align="center"><b>Loading</b><br><sub>Real headings, unknown covers</sub></td>
<td align="center"><b>Offline</b><br><sub>Last known library, dated</sub></td>
<td align="center"><b>Account</b><br><sub>From the avatar</sub></td>
</tr>
</table>

## What it does

- **Import PDFs** from the system picker. The first page is rendered as a real
  cover, and the page count comes off the same load.
- **Read offline.** Documents live on the device; the library stays legible
  without a connection, from a cached copy of the last answer.
- **Sync what is worth syncing.** Per document, up to 100 MB, to Cloudflare R2
  behind a signed URL that expires in five minutes.
- **Pick up where you left off.** Reading position is written when you leave a
  document, and drives Continue Reading on every device.
- **Organise** with collections and favourites. A collection is a relationship,
  never a second copy of the file.

## Stack

| | |
| --- | --- |
| **App** | Expo SDK 57, React Native 0.86 (New Architecture), Expo Router |
| **UI** | gluestack-ui v5, NativeWind v5, Tailwind v4 tokens |
| **Backend** | Convex — schema, queries, mutations, crons |
| **Auth** | Google Sign-In, verified by Convex as an OIDC provider |
| **Files** | Cloudflare R2 via `@convex-dev/r2`; PDFs on-device via `expo-file-system` |
| **Lists** | FlashList v2 |

## Getting started

Native Google Sign-In needs custom native code, so **Expo Go will not work** —
you need a development build.

```bash
npm install
npx convex dev            # creates the deployment, writes convex/_generated
npx expo prebuild --clean
npx expo run:android      # or run:ios
```

There is more to set up than that: a Google OAuth client per platform, and a
Cloudflare R2 bucket if you want documents on more than one device.
**[docs/setup.md](docs/setup.md)** has all of it.

## Documentation

| | |
| --- | --- |
| [Setup](docs/setup.md) | Google, Cloudflare, environment variables, scripts |
| [Architecture](docs/architecture.md) | Where a PDF lives, syncing, offline, covers, the reader |
| [Security](docs/security.md) | Identity, ownership, and the reasoning behind both |
| [Design](docs/design.md) | Tokens, the type scale, and the design canvas |
| [Contributing](CONTRIBUTING.md) | How to propose a change |

## Status

Google sign-in, the library, importing with real covers, collections,
favourites, offline reading, syncing to R2, and a reader that keeps your place.
Bookmarks and highlights are not built yet.

## Licence

[MIT](LICENSE) © Telvin Teum
