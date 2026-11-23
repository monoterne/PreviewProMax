# Preview Pro Max

## Workflow

- Commit to `main` and push directly. Create branches or pull requests only on request. Report the commit after pushing.
- Use short, lowercase, type-prefixed commit subjects and workflow run names. Check Actions runs or artifacts only when asked.
- Keep the CI token read-only. Test production builds on pushes and pull requests to `main`, including Dependabot. Use Node 24 actions and Bun for web tooling.
- Use Tauri's system webview. Keep Bun, Node, and browser test runtimes out of the app. Preserve the size-optimized Rust release profile and the download formats in [README.md](README.md).

## Verification

- Renderer changes require `bun run typecheck`, `bun test`, and `bun run build:web`. Run `bun run test:ui` for viewer changes, with WebKit and Chromium installed.
- For native, packaging, or dependency changes, run the host's `bun run dist:mac`, `bun run dist:win`, or `bun run dist:linux`. Confirm the platform artifacts before claiming release support.
- On macOS, run `bun run test:native` after building the web assets. It exercises the installed WKWebView over `tauri://`.
- For rendering changes, check bundle size and long-PDF scrolling. For visual changes, review light and dark pages and thumbnails, narrow windows, and keyboard access.
- Commit generated PDF fixtures with redistributable fonts. Keep user PDFs and extracted pages out of the repository.

## Viewer invariants

- Load the stream compatibility shim before PDF.js. Use the PDF.js legacy renderer, viewer, and worker together. Test missing APIs in both the window and worker with an embedded CFF font.
- Keep pages and thumbnails lazy. Cap raster size, cancel stale renders, and evict offscreen canvases. Preserve embedded image colors in dark mode with strip processing.
- Use PDF.js Find offsets against the rendered text items, including empty items and line endings. Report extraction failures. Cancel stale searches and navigation, and resolve a match before scrolling to it.
- Keep page, zoom, rotation, and Find state per tab. Keep the file-open queue and PDF.js worker per window. Release inactive canvases and destroy closed documents.
- Use native drag-and-drop events. Route OS file opens to the focused window and open each file in a tab. Let PDF.js validate files and preserve the current document on failure.
- Create windows hidden and reveal them once the themed renderer is ready. Follow the system theme until a window overrides it. Persist image inversion across windows.
- Keep the toolbar fixed, reuse theme tokens and native controls, and keep inputs and sidebar tabs mounted across view changes.
