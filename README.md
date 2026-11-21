# Preview Pro Max

A desktop PDF viewer for Linux, macOS and Windows. The interface uses Bun, TypeScript, CSS, and Mozilla PDF.js; Tauri supplies the native window and file picker. The finished app uses the operating system webview and includes no Node or Bun runtime.

## Install and update

**macOS.** On Apple silicon, Homebrew installs the legacy build on macOS 11 Big Sur through macOS 15 Sequoia. It installs the adaptive build on macOS 26 Tahoe and later.

```sh
brew tap monoterne/preview-pro-max
brew install --cask monoterne/preview-pro-max/preview-pro-max
```

To update, run `brew update` followed by `brew upgrade --cask preview-pro-max`. The macOS builds are ad-hoc signed.

**Linux.** The signed Flatpak repository provides the stable app for x86-64 and ARM64. Flathub supplies its GNOME runtime.

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak remote-add --user --if-not-exists preview-pro-max https://raw.githubusercontent.com/monoterne/preview-pro-max-flatpak/main/preview-pro-max.flatpakrepo
flatpak install --user preview-pro-max com.previewpromax.viewer
flatpak run com.previewpromax.viewer
```

To update, run `flatpak update --user com.previewpromax.viewer`. You can also use a software center with Flatpak support.

Maintainers can find publishing instructions and Windows distribution options in the [release guide](packaging/README.md).

## Features

- Open PDFs, including password protected PDFs, from the file picker, drag and drop, or the operating system's PDF file association; unsupported files show a clear error
- Page thumbnails, nested table of contents, page navigation, zoom, fit width, and rotation
- Find every occurrence of readable text and select a result
- Light and dark mode for the app, PDF pages, and thumbnails, with an option to keep embedded image colors in dark mode
- Lazy rendering with offscreen canvas eviction and a page raster limit
- Restore open windows and their document tabs after restarting the app

PDF.js opens PDF documents, including PDFs whose names do not end in `.pdf`. The app accepts any file from the picker or a drop so PDF.js can validate it, then reports unsupported files without closing the current document.

Use **View options** in the toolbar for rotation and appearance settings. Dark mode changes only the display. The **Invert images** switch is available while dark mode is on. Turn it off to leave embedded images in their original colors while darkening the rest of each page.

## Development

Install [Bun](https://bun.sh/) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/), including Rust and the platform's development tools. Node.js is not required.

```sh
bun install
bun run dev
```

## Build

```sh
bun run typecheck
bun run dist:linux # on Linux: .deb and .rpm packages
bun run dist:mac # on macOS: .app
bun run dist:win # on Windows: NSIS installer and portable .exe
```

The native outputs are in `src-tauri/target/release/bundle/`. On Windows, `src-tauri/target/release/preview-pro-max.exe` is the portable executable and requires the system WebView2 runtime. The NSIS installer can download WebView2 if it is missing. The GitHub Actions desktop workflow publishes downloads for each platform.

For x86-64 Linux, unzip the artifact for your distribution and run its install command from that directory.

| Distribution | CI artifact | Install |
| --- | --- | --- |
| Ubuntu 24.04 | `preview-pro-max-linux` | `sudo apt install ./*.deb` |
| Fedora 44 | `preview-pro-max-linux-fedora` | `sudo dnf install ./*.rpm` |

The package manager installs the system WebKitGTK 4.1 runtime. Open Preview Pro Max from the applications menu, use **Open With** on PDFs, or pass one or more file paths to `preview-pro-max`.

On macOS 15, download `PreviewProMax-mac-legacy.app.zip` from the workflow's Artifacts section and double-click it in Finder to extract `Preview Pro Max.app`.

macOS builds use an ad-hoc signature. Public distribution without installation prompts requires an Apple Developer ID and notarization.

PDF rendering is provided by [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) under the Apache 2.0 license.

## Tabs and windows

Opening files adds document tabs. The picker and drag and drop accept multiple files. Each tab keeps its page position, zoom, rotation, and Find results. Use the **+** button for an empty tab and **New window** at the right of the tab bar for an independent window.

On launch, previously open windows reopen with their PDF tabs, selected tab, page, zoom, rotation, and scroll position. Empty tabs and new empty windows list saved windows; choose one to reopen its PDFs. Files that have moved or been deleted are skipped.

Pinch on a trackpad or use Ctrl/Cmd plus the mouse wheel over a page to zoom around the pointer. Ordinary wheel scrolling moves through the PDF.

| Action | macOS | Windows and Linux |
| --- | --- | --- |
| Open files | ⌘O | Ctrl+O |
| New tab | ⌘T | Ctrl+T |
| New window | ⌘N | Ctrl+N |
| Close tab (last tab closes window) | ⌘W | Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Find | ⌘F | Ctrl+F |
| Next / previous match in Find | Enter / Shift+Enter | Enter / Shift+Enter |

New windows use the system's light or dark appearance and follow system changes until you change the theme in that window. **Invert images** is remembered between launches and shared across windows.

Renderer regression checks use development-only browser tooling, which is excluded from the app:

```sh
bunx playwright install webkit chromium
bun run test:ui
```

The browser checks use the production build and simulate older webview APIs. On macOS, also run the native webview check:

```sh
bun run build:web
bun run test:native
```

PDF.js's compatibility renderer and worker preserve embedded fonts on older system webviews. A small stream compatibility layer supports text extraction on macOS 15. Extraction errors are reported rather than shown as an empty result set.
