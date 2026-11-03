#!/usr/bin/env bash
# Run the XOS fork headless (orcad) so automation schedules keep firing with the desktop UI closed.
# Started by the orca-xos-serve systemd user service. The AppImage is extracted once per build,
# because a FUSE mount would vanish with the process that made it.
set -euo pipefail

APPIMAGE="${ORCA_XOS_APPIMAGE:-$HOME/Applications/Orca-XOS.AppImage}"
CACHE="${ORCA_XOS_SERVE_CACHE:-$HOME/.cache/orca-xos/serve}"

if [[ ! -x "$APPIMAGE" ]]; then
  echo "[orca-xos-serve] $APPIMAGE is missing; run xos/switch-to-fork.sh first." >&2
  exit 1
fi

# One extraction per build: size + mtime changes whenever switch-to-fork.sh installs a new AppImage.
key="$(stat -Lc '%s-%Y' "$APPIMAGE")"
dir="$CACHE/$key"
if [[ ! -x "$dir/resources/bin/orca-ide" ]]; then
  echo "[orca-xos-serve] Extracting $APPIMAGE to $dir"
  tmp="$CACHE/.extract-$$"
  rm -rf "$tmp" && mkdir -p "$tmp"
  (cd "$tmp" && "$APPIMAGE" --appimage-extract >/dev/null)
  rm -rf "$dir"
  mv "$tmp/squashfs-root" "$dir"
  rm -rf "$tmp"
  # Keep only the current build.
  find "$CACHE" -mindepth 1 -maxdepth 1 -type d ! -name "$key" -exec rm -rf {} +
fi

# --supervise: restarts on crashes and waits (instead of failing) while the desktop app holds the profile.
exec "$dir/resources/bin/orca-ide" serve --supervise --no-pairing "$@"
