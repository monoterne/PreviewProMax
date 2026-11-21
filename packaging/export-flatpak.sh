#!/usr/bin/env bash
# Append one architecture to the signed stable channel in a distribution checkout.
set -euo pipefail
deb=${1:?Pass a Preview Pro Max deb}
channel=${2:?Pass the Flatpak distribution checkout}
key=${3:?Pass the signing key fingerprint}
id=com.previewpromax.viewer
test "$(dpkg-deb -f "$deb" Package)" = preview-pro-max
version=$(dpkg-deb -f "$deb" Version)
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
release_version=${4:-$version}
if [[ "$release_version" != "$version" ]]; then
  [[ "$release_version" =~ ^[0-9]+\.[0-9]+$ && "$version" == "$release_version.0" ]]
fi
case "$(dpkg-deb -f "$deb" Architecture)" in
  amd64) arch=x86_64 ;;
  arm64) arch=aarch64 ;;
  *) echo "Unsupported Debian architecture" >&2; exit 1 ;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Clients pin this public key when they add the remote.
gpg --batch --export "$key" > "$work/public.gpg"
test -s "$work/public.gpg"
if [[ -e "$channel/release.gpg" ]]; then
  cmp "$channel/release.gpg" "$work/public.gpg"
fi
repo="$channel/repo"
# Git omits the empty ref directories in a fresh distribution checkout.
mkdir -p "$repo/refs/remotes" "$repo/refs/mirrors"
ostree init --repo="$repo" --mode=archive-z2
dpkg-deb -x "$deb" "$work/deb"
app="$work/app"
mkdir -p "$app/files" "$app/var"
cat > "$app/metadata" <<META
[Application]
name=$id
runtime=org.gnome.Platform/$arch/51
sdk=org.gnome.Sdk/$arch/51
META
install -Dm755 "$work/deb/usr/bin/preview-pro-max" "$app/files/bin/$id"
desktop="$app/files/share/applications/$id.desktop"
install -Dm644 "$work/deb/usr/share/applications/preview-pro-max.desktop" "$desktop"
# GTK derives the Wayland app ID from argv[0]. Match the exported desktop ID.
sed -i -e "s/^Exec=preview-pro-max /Exec=$id /" -e "s/^Icon=preview-pro-max$/Icon=$id/" \
  -e "s/^StartupWMClass=preview-pro-max$/StartupWMClass=$id/" "$desktop"
for icon in "$work/deb"/usr/share/icons/hicolor/*/apps/preview-pro-max.png; do
  size=$(basename "$(dirname "$(dirname "$icon")")")
  install -Dm644 "$icon" "$app/files/share/icons/hicolor/$size/apps/$id.png"
done
mkdir -p "$app/files/share/metainfo"
cat > "$app/files/share/metainfo/$id.metainfo.xml" <<META
<component type="desktop-application">
  <id>$id</id>
  <metadata_license>CC0-1.0</metadata_license>
  <name>Preview Pro Max</name>
  <summary>Read, search and annotate PDFs</summary>
  <description><p>Open PDFs in tabs, navigate outlines, find text and add annotations.</p></description>
  <launchable type="desktop-id">$id.desktop</launchable>
  <url type="homepage">https://github.com/monoterne/PreviewProMax</url>
  <releases><release version="$release_version" date="$(date -u +%F)"/></releases>
</component>
META
catalog="$app/files/share/app-info"
appstreamcli compose --no-net --prefix=/ --origin="$id" --data-dir="$catalog/xmls" \
  --icons-dir="$catalog/icons/flatpak" "$app/files"
flatpak build-finish --command="$id" --share=ipc --socket=wayland \
  --socket=fallback-x11 --device=dri --env=GTK_USE_PORTAL=1 "$app"
flatpak build-export --arch="$arch" --gpg-sign="$key" "$repo" "$app" stable
flatpak build-update-repo --gpg-sign="$key" "$repo"
install -m644 "$work/public.gpg" "$channel/release.gpg"
cat > "$channel/preview-pro-max.flatpakrepo" <<REMOTE
[Flatpak Repo]
Title=Preview Pro Max
Url=https://raw.githubusercontent.com/monoterne/preview-pro-max-flatpak/main/repo/
GPGKey=$(base64 -w0 "$work/public.gpg")
DefaultBranch=stable
REMOTE
