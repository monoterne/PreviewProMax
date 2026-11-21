# Publishing an update

Both channels follow versioned releases. Users receive a new build when the maintainer publishes it to their channel and their package manager checks for updates.

## Homebrew

1. Build the two Apple silicon app ZIPs from the same versioned source using the legacy and adaptive macOS configurations in the desktop workflow. Verify each extracted app with `codesign --verify --deep --strict`.
2. Attach `PreviewProMax-mac-legacy.app.zip` and `PreviewProMax-mac-adaptive.app.zip` to the upstream GitHub release tagged `vVERSION`. Keep versioned assets immutable so existing cask checksums continue to verify.
3. Clone or update the tap. From the application source checkout, run the helper with the version, ZIP directory and tap checkout.

```sh
packaging/update-cask.sh "$version" "$release_assets" "$tap_checkout"
```

Review the version and both SHA-256 values, commit the updated cask and push it to the tap's main branch. Homebrew fetches the new version on the next update. [Homebrew tap maintenance](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)

## Flatpak

Use a Linux machine with Flatpak, OSTree, GnuPG, dpkg and the AppStream Compose addon. Build the project's release deb for each target architecture from the same version. Clone the distribution repository and pull its latest main before exporting so the new commits extend the installed stable refs. [Flatpak repository hosting](https://docs.flatpak.org/en/latest/hosting-a-repository.html)

```sh
git clone https://github.com/monoterne/preview-pro-max-flatpak.git
channel="$PWD/preview-pro-max-flatpak"
fingerprint=$(cat "$channel/signing-fingerprint")
packaging/export-flatpak.sh "$amd64_deb" "$channel" "$fingerprint"
packaging/export-flatpak.sh "$arm64_deb" "$channel" "$fingerprint"
ostree --repo="$channel/repo" fsck
```

The signing key must be available to the publishing GnuPG keyring. The original publisher's backup is stored as a base64-encoded secret key in the macOS login Keychain under the service `Preview Pro Max Flatpak signing key`, account `monoterne`. To import it into a trusted Linux signing machine, pipe the Keychain value directly over SSH.

```sh
security find-generic-password -s 'Preview Pro Max Flatpak signing key' -a monoterne -w |
  base64 -D | ssh "$signing_host" gpg --batch --import
```

Commit the resulting distribution changes together and push to main. The stable remote URL and public key let existing installations verify and apply the update. On a test installation, run `flatpak update --user com.previewpromax.viewer` and compare `flatpak info --show-commit com.previewpromax.viewer` with `flatpak remote-info --show-commit preview-pro-max com.previewpromax.viewer`.

## Windows distribution options

| Option | Fit for Preview Pro Max | How updates reach users |
| --- | --- | --- |
| WinGet community repository | Publish the existing NSIS installer at a versioned release URL. Submit a manifest with installer type `nullsoft`, architecture, version and SHA-256. Verify installed-app detection against the NSIS uninstall entry. | Each accepted manifest makes the new version available through `winget upgrade`. [Manifest reference](https://learn.microsoft.com/en-us/windows/package-manager/package/manifest) · [Submission](https://learn.microsoft.com/en-us/windows/package-manager/package/repository) |
| Scoop bucket | Host a Git bucket containing a JSON manifest for the portable EXE, its checksum and a Start menu shortcut. The portable viewer requires WebView2 on the target system. | Publish an updated manifest in the bucket. Users run `scoop update preview-pro-max`. [Buckets](https://github.com/ScoopInstaller/Scoop/wiki/Buckets) · [Manifests](https://github.com/ScoopInstaller/Scoop/wiki/App-Manifests) |
| Tauri updater | Add the updater plugin to the Windows build and sign each NSIS release with a dedicated updater key. Host the installer and a versioned entry in a stable HTTPS JSON feed. | The app can check on startup or from a menu, verify the signature and run the installer. [Tauri updater](https://v2.tauri.app/plugin/updater/) |
| MSIX with App Installer | Produce an MSIX signed with a certificate trusted by the target devices and host a stable `.appinstaller` file. Preserve the package identity and publisher across releases. | Users install through the descriptor. Windows can then check on launch or in the background according to its update settings. [App Installer](https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview) |

WinGet is the shortest path for the existing installer. A Scoop bucket gives the project direct control over a portable update channel. For updates initiated inside the existing NSIS app, use the Tauri updater. MSIX offers Windows-managed checks for installations made through App Installer.
