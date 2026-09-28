# Preview Pro Max

A desktop PDF reader for macOS and Windows, built with Electron, TypeScript, Bun, Vite, React, Radix UI, and Mozilla PDF.js.

## Features

- Open PDFs from the file picker, drag and drop, the app menu, or the operating system's file association
- Page thumbnails, page navigation, zoom, fit width, and rotation
- Search readable text across the document
- Select text on rendered pages
- Light and dark mode for the app, PDF pages, and thumbnails
- Lazy page and thumbnail rendering for large documents

Dark mode applies a display filter to each rendered page and thumbnail. It is reversible and does not change the PDF file. Photos and other page colors will also be transformed.

## Development

Requires [Bun](https://bun.sh/) and a supported macOS or Windows version.

```sh
bun install
bun run dev
```

## Build

```sh
bun run typecheck
bun run build
bun run dist:mac # on macOS
bun run dist:win # on Windows
```

The installer scripts write to `release/`. Distributable apps need platform-specific signing for a smooth installation experience. Build macOS packages on macOS and Windows packages on Windows. The GitHub Actions workflow in `.github/workflows/build.yml` builds both platforms and uploads their artifacts.

PDF rendering is provided by [Mozilla PDF.js](https://mozilla.github.io/pdf.js/), which is licensed under Apache 2.0.
