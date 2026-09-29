# Preview Pro Max

A desktop PDF viewer for macOS and Windows. The interface uses Bun, TypeScript, React, Radix UI, and Mozilla PDF.js; Tauri supplies the native window and file picker. The finished app uses the operating system webview and includes no Node or Bun runtime.

## Features

- Open PDFs from the file picker, drag and drop, or the operating system's PDF file association
- Page thumbnails, page navigation, zoom, fit width, and rotation
- Search and select readable text
- Light and dark mode for the app, PDF pages, and thumbnails
- Lazy rendering with offscreen canvas eviction and a page raster limit

Dark mode applies a display filter to each rendered page and thumbnail. It does not change the file, and it also transforms photos and other page colors.

## Development

Install [Bun](https://bun.sh/) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/), including Rust and the platform's development tools. Node.js is not required.

```sh
bun install
bun run dev
```

## Build

```sh
bun run typecheck
bun run dist:mac # on macOS: .app
bun run dist:win # on Windows: NSIS installer and portable .exe
```

The native outputs are in `src-tauri/target/release/bundle/`. On Windows, `src-tauri/target/release/preview-pro-max.exe` is the portable executable and requires the system WebView2 runtime. The NSIS installer can download WebView2 if it is missing. The GitHub Actions workflow uploads a zipped macOS `.app`, the portable Windows `.exe`, and the Windows installer.

macOS builds use an ad-hoc signature. Public distribution without installation prompts requires an Apple Developer ID and notarization.

PDF rendering is provided by [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) under the Apache 2.0 license.
