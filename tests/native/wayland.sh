# Check that the installed launcher matches the app ID sent to a Wayland compositor.
set -euo pipefail
work=$(mktemp -d)
trap 'jobs -pr | xargs -r kill 2>/dev/null || true; rm -rf "$work"' EXIT
export XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache"
export XDG_RUNTIME_DIR="$work/runtime" WAYLAND_DISPLAY=preview-wayland GDK_BACKEND=wayland
mkdir -m 700 "$XDG_RUNTIME_DIR"

weston --backend=headless-backend.so --shell=kiosk-shell.so --socket="$WAYLAND_DISPLAY" --idle-time=0 >"$work/weston.log" 2>&1 &
for ((attempt=0; attempt<100; attempt++)); do
  if [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then break; fi
  sleep 0.1
done
if [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
  cat "$work/weston.log" >&2
  exit 1
fi

app_id=preview-pro-max
test -f "/usr/share/applications/$app_id.desktop"
WAYLAND_DEBUG=client "$app_id" >"$work/viewer.log" 2>&1 &
viewer=$!
for ((attempt=0; attempt<120; attempt++)); do
  if grep -Eq "xdg_toplevel[@#][0-9]+\.set_app_id\(\"$app_id\"\)" "$work/viewer.log"; then exit 0; fi
  if ! kill -0 "$viewer" 2>/dev/null; then break; fi
  sleep 0.5
done
echo "The viewer did not announce the Wayland app ID $app_id" >&2
tail -n 60 "$work/viewer.log" >&2
exit 1
