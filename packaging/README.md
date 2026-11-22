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

Use a Linux machine with Flatpak, OSTree, GnuPG, dpkg and the AppStream Compose addon. Use the amd64 and arm64 release debs from the same desktop workflow run. Clone the distribution repository and pull its latest main before exporting so the new commits extend the installed stable refs. [Flatpak repository hosting](https://docs.flatpak.org/en/latest/hosting-a-repository.html)

```sh
git clone https://github.com/monoterne/preview-pro-max-flatpak.git
channel="$PWD/preview-pro-max-flatpak"
fingerprint=$(cat "$channel/signing-fingerprint")
packaging/export-flatpak.sh "$amd64_deb" "$channel" "$fingerprint"
packaging/export-flatpak.sh "$arm64_deb" "$channel" "$fingerprint"
ostree --repo="$channel/repo" fsck
```

If the public release uses a short version such as `0.3`, pass it as the fourth argument to both exports. The script validates it against the deb version (in this example, `0.3.0`).

The signing key must be available to the publishing GnuPG keyring. The original publisher's backup is stored as a base64-encoded secret key in the macOS login Keychain under the service `Preview Pro Max Flatpak signing key`, account `monoterne`. To import it into a trusted Linux signing machine, pipe the Keychain value directly over SSH.

```sh
security find-generic-password -s 'Preview Pro Max Flatpak signing key' -a monoterne -w |
  base64 -D | ssh "$signing_host" gpg --batch --import
```

Commit the resulting distribution changes together and push to main. The stable remote URL and public key let existing installations verify and apply the update. On a test installation, run `flatpak update --user com.previewpromax.viewer` and compare `flatpak info --show-commit com.previewpromax.viewer` with `flatpak remote-info --show-commit preview-pro-max com.previewpromax.viewer`.
