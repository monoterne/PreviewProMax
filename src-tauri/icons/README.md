# Desktop app icon

`PreviewProMax.icon` is the editable Icon Composer project. The original artwork
uses a document, a blue mountain photograph, and a magnifier to echo the visual
language of Preview on macOS 15. It does not contain Apple's artwork.

On macOS 26 and later, the app uses the layered project compiled into `Assets.car`.
The icon has Default and Dark appearances; Icon Composer also derives the
clear and tinted appearances from these layers. Windows and macOS before 26
use the neutral flattened `icon.ico` and `icon.icns` respectively. These remain
legible against light and dark desktops; legacy icon formats do not provide
the system appearance switching of the layered macOS icon.

Run `bun run icons` to regenerate the SVG layers and desktop fallbacks from
`scripts/generate-icons.ts`. This requires Bun and the existing Tauri CLI only.
Open the `.icon` project in Apple's Icon Composer to inspect its materials.
Change the generator when editing artwork so regeneration preserves the edits.

The checked-in catalog lets macOS builds use the adaptive icon with Command Line
Tools alone. The build verifies its source and catalog hashes before using it.
After changing the artwork, regenerate the catalog with full Xcode 26 or newer
(Command Line Tools alone do not include `actool`):

```sh
bun run icons:mac
```

The build compiles the source whenever full Xcode is available. It runs `actool`
with an open stdin to avoid Tauri's compiler-launch crash (tauri-apps/tauri#15315).
macOS CI always recompiles and saves `Assets.car` and `catalog.json` in a separate
`preview-pro-max-icon-catalog` artifact to refresh the checked-in cache. CI also
requires both `Assets.car` and the legacy `.icns` in the app bundle.
