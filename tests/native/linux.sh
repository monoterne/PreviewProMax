# Exercise the installed desktop entry and single-instance forwarding on an isolated display.
set -euo pipefail
fixture=${1:?Pass the path to the smoke test PDF}
work=$(mktemp -d)
trap 'if [[ -n "${reopened:-}" ]]; then kill "$reopened" 2>/dev/null || true; fi; rm -rf "$work"' EXIT
export XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache"
export XDG_RUNTIME_DIR="$work/runtime"
mkdir -m 700 "$XDG_RUNTIME_DIR"
export GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1
desktop='/usr/share/applications/preview-pro-max.desktop'
desktop-file-validate "$desktop"
grep -q '^MimeType=.*application/pdf;' "$desktop"
grep -Fxq 'Icon=preview-pro-max' "$desktop"
test -s /usr/share/icons/hicolor/128x128/apps/preview-pro-max.png
grep -Fxq 'NoDisplay=true' '/usr/share/applications/Preview Pro Max.desktop'
mkdir -p "$work/other"
cp "$fixture" "$work/first file.pdf"
cp "$work/first file.pdf" "$work/second.pdf"
cp "$work/first file.pdf" "$work/other/forwarded file.pdf"
session="$XDG_CONFIG_HOME/com.previewpromax.viewer/sessions.json"
wait_for_tabs() {
  for ((i=0; i<120; i++)); do
    if jq -e --argjson paths "$1" --argjson after "${2:-0}" '
      .windows | length == 1 and .[0].updated > $after and (.[0].tabs | map(.path)) == $paths
    ' "$session" >/dev/null 2>&1; then
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
all_tabs=$(jq -cn --args '$ARGS.positional' "$work/first file.pdf" "$work/second.pdf" "$work/other/forwarded file.pdf")
wait_for_tabs "$all_tabs"

# Move and resize the native window, then reopen the saved session.
window=$(xdotool search --onlyvisible --name 'Preview Pro Max$' | head -n 1)
xdotool windowmove "$window" 80 60
xdotool windowsize "$window" 900 620
frame_filter='.windows[0].frame | .kind == "desktop" and .position == [80, 60] and .size == [900, 620]'
for ((i=0; i<60; i++)); do
  if jq -e "$frame_filter" "$session" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
jq -e "$frame_filter" "$session" >/dev/null
kill "$(xdotool getwindowpid "$window")"
for ((i=0; i<60; i++)); do
  if ! xdotool getwindowname "$window" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
last_update=$(jq -er '.windows[0].updated' "$session")
preview-pro-max &
reopened=$!
window=$(timeout 30 xdotool search --sync --all --onlyvisible --pid "$reopened" --name 'Preview Pro Max$' | head -n 1)
geometry=$(xdotool getwindowgeometry --shell "$window" | sed -nE '/^(X|Y|WIDTH|HEIGHT)=/p')
test "$geometry" = $'X=80\nY=60\nWIDTH=900\nHEIGHT=620'

# Find text on the last page in the real WebKitGTK view, then verify navigation.
wait_for_tabs "$all_tabs" "$last_update"
xdotool windowfocus --sync "$window"
xdotool key ctrl+f
xdotool type --clearmodifiers 'Page 24'
for ((i=0; i<60; i++)); do
  xdotool key Return
  sleep 0.5
  if jq -e '.windows[0] | .tabs[.active].page == 24' "$session" >/dev/null; then
    exit 0
  fi
done
echo 'Find did not navigate to page 24 in the installed viewer' >&2
cat "$session" >&2
exit 1
