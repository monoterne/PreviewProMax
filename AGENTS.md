# Project guidance

Preview Pro Max is a desktop PDF viewer built with Tauri 2, Bun, TypeScript, React, Radix UI, and PDF.js. Bun installs dependencies and builds the web UI. Rust builds the native shell. Released apps must not embed Node, Bun, or Chromium.

Run `bun run typecheck`, `bun test`, and `bun run build:web` after renderer changes. Run `bun run dist:mac` on macOS or `bun run dist:win` on Windows after native, packaging, or dependency changes. Verify the GitHub Actions artifacts on both platforms before claiming release support.
Use current GitHub Actions versions that run on Node 24; do not add Node 20 actions or a Node.js setup step. Keep Bun as the package manager and frontend build tool, and keep application code in TypeScript or Rust.

## Size and memory

- Keep the Rust release profile optimized for size: one codegen unit, LTO, `opt-level = "z"`, abort on panic, stripped symbols, and no incremental release build.
- Add native plugins and bundled assets only when required by a user feature. Use the operating system webview and keep Bun as a build tool only.
- Keep PDF pages and thumbnails lazy. Evict canvases far outside the viewport, cap page raster pixels, and avoid retaining duplicate PDF byte buffers or text indexes unnecessarily.
- Keep image preserving dark mode bounded in memory: process page pixels in strips and do not retain a second full-page canvas.
- Preserve the single macOS `.app` bundle and portable Windows `.exe` as downloadable artifacts. The NSIS installer is also provided for Windows systems that need WebView2 setup.
- When changing rendering or dependencies, compare bundle size and test scrolling through a long PDF for memory growth and visual regressions. Do not trade away correct rendering, text selection, or accessibility just to reduce bytes.

## UI rules

- Keep the interface functional and restrained. The first screen is the viewer or a simple open-file state, never a marketing hero.
- Use the existing light and dark CSS tokens. The sidebar, toolbar, page, and thumbnail should follow the same theme. Keep light PDF pages white and dark PDF pages dark.
- Keep the toolbar fixed as the PDF pane scrolls; scrolling a document must not move or cover toolbar controls.
- Use Tauri's native file drop event so drops work in the system webview on macOS 15 and newer. Keep the drop overlay tied to native enter, leave, and drop events.
- Let PDF.js validate files from the picker and drop path. Show a clear error for unsupported files and keep the current document open.
- List every Find occurrence, including repeated matches on one page, and keep the count and selected result in sync.
- Offer an image inversion switch with dark mode. When inversion is off, preserve embedded image pixels while darkening the rest of the page and thumbnail.
- Use Radix primitives for interactive patterns such as tabs and switches. Keep native buttons and inputs simple and accessible.
- Use a system sans-serif font, a consistent 4/8/12/16/24/32px spacing scale, subtle borders, and 6–10px control radii.
- Avoid decorative gradients, glows, floating cards, oversized headings, eyebrow labels, mottos, filler descriptions, and large shadows.
- Keep hover effects to color or border changes. Reserve motion for functional state changes.
- Make labels and focus states clear. Check narrow windows, long file names, empty states, selected states, loading, and errors.

## UI review

Before finishing a UI change, check that navigation remains usable, controls have accessible names, tabs work by keyboard, the PDF and thumbnail themes agree, and the screen has no decoration without a task. Review both light and dark screenshots with a real PDF.
