# Desktop app icon

`PreviewProMax.icon` is the editable Icon Composer project. The original artwork
uses a document, a blue mountain photograph, and a magnifier to echo the visual
language of Preview on macOS 15. It does not contain Apple's artwork.

On macOS 26 and later, Tauri compiles the layered project into `Assets.car`.
The icon has Default and Dark appearances; Icon Composer also derives the
clear and tinted appearances from these layers. Windows and macOS before 26
use the neutral flattened `icon.ico` and `icon.icns` respectively. These remain
legible against light and dark desktops; legacy icon formats do not provide
the system appearance switching of the layered macOS icon.

Run `bun run icons` to regenerate the SVG layers and desktop fallbacks from
`scripts/generate-icons.ts`. This requires Bun and the existing Tauri CLI only.
Open the `.icon` project in Apple's Icon Composer to inspect its materials.
Change the generator when editing artwork so regeneration preserves the edits.

Packaging the adaptive icon requires full Xcode 26 or newer with `actool` in
`PATH` (Command Line Tools alone do not include it). For example:

```sh
export PATH="$(dirname "$(xcrun --find actool)"):$PATH"
bun run dist:mac
```

Without the compiler, Tauri logs a warning and builds the conventional icon.
CI requires both `Assets.car` and the legacy `.icns` in the macOS bundle so
release artifacts cannot silently lose the adaptive appearance.
