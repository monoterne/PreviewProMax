#!/usr/bin/env bash
# Generate the tap entry from the two exact ZIPs attached to a versioned release.
set -euo pipefail
version=${1:?Pass the released version without v}
assets=${2:?Pass the release asset directory}
tap=${3:?Pass the Homebrew tap checkout}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
checksum() { shasum -a 256 "$assets/PreviewProMax-mac-$1.app.zip" | cut -d' ' -f1; }
legacy=$(checksum legacy)
adaptive=$(checksum adaptive)
mkdir -p "$tap/Casks"
cat > "$tap/Casks/preview-pro-max.rb" <<CASK
cask "preview-pro-max" do
  version "$version"

  on_sequoia :or_older do
    sha256 "$legacy"
    url "https://github.com/monoterne/PreviewProMax/releases/download/v#{version}/PreviewProMax-mac-legacy.app.zip"
  end
  on_tahoe :or_newer do
    sha256 "$adaptive"
    url "https://github.com/monoterne/PreviewProMax/releases/download/v#{version}/PreviewProMax-mac-adaptive.app.zip"
  end

  name "Preview Pro Max"
  desc "Desktop PDF viewer"
  homepage "https://github.com/monoterne/PreviewProMax"

  depends_on arch: :arm64
  depends_on macos: :sequoia

  app "Preview Pro Max.app"
end
CASK
