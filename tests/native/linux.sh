# Exercise the installed desktop entry and single-instance forwarding on an isolated display.
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache"
export GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1
desktop=$(dpkg -L preview-pro-max | sed -n '/^\/usr\/share\/applications\/.*\.desktop$/p')
desktop-file-validate "$desktop"
grep -q '^MimeType=.*application/pdf;' "$desktop"
mkdir -p "$work/other"
bun -e 'import { fixture } from "./tests/fixtures/pdf"; await Bun.write(process.argv[1], new Uint8Array(fixture()))' "$work/first file.pdf"
cp "$work/first file.pdf" "$work/second.pdf"
cp "$work/first file.pdf" "$work/other/forwarded file.pdf"
session="$XDG_CONFIG_HOME/com.previewpromax.viewer/sessions.json"
wait_for_tabs() {
  for ((i=0; i<120; i++)); do
    if jq -e --argjson paths "$1" '.windows | length == 1 and (.[0].tabs | map(.path)) == $paths' "$session" 2>/dev/null; then
      return
    fi
    sleep 0.5
  done
  echo "Timed out waiting for open documents: $1" >&2
  cat "$session" >&2 || true
  return 1
}

gio launch "$desktop" "$work/first file.pdf" "$work/second.pdf"
timeout 60 xdotool search --sync --onlyvisible --name 'Preview Pro Max$'
wait_for_tabs "$(jq -cn --args '$ARGS.positional' "$work/first file.pdf" "$work/second.pdf")"
(cd "$work/other" && timeout 30 preview-pro-max 'forwarded file.pdf')
wait_for_tabs "$(jq -cn --args '$ARGS.positional' "$work/first file.pdf" "$work/second.pdf" "$work/other/forwarded file.pdf")"
