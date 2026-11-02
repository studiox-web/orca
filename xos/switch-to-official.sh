#!/usr/bin/env bash
# Roll back to the official Orca AppImage. Run with Orca closed.
# Pass a backup archive to also restore the profile from before the switch:
#   switch-to-official.sh ~/orca-profile-backups/orca-profile-<stamp>.tar.gz
set -euo pipefail

OFFICIAL="${ORCA_OFFICIAL_APPIMAGE:-$HOME/Downloads/Orca.AppImage}"

if pgrep -f '(\.mount_[Oo]rca|Orca(-XOS)?\.AppImage|orca-ide)' >/dev/null; then
  echo "Orca is still running. Quit it completely, then run this again." >&2
  exit 1
fi

if [[ $# -ge 1 ]]; then
  mv "$HOME/.config/orca" "$HOME/.config/orca.fork-$(date '+%Y%m%d-%H%M%S')"
  tar -xzf "$1" -C "$HOME/.config"
  echo "Profile restored from $1 (fork-era profile kept beside it)."
fi

setsid nohup "$OFFICIAL" >/dev/null 2>&1 < /dev/null &
echo "Launched $OFFICIAL"
