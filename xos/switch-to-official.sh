#!/usr/bin/env bash
# Roll back to the official Orca AppImage. Run with Orca closed.
# Pass a backup archive to also restore the profile from before the switch:
#   switch-to-official.sh ~/orca-profile-backups/orca-profile-<stamp>.tar.gz
set -euo pipefail

OFFICIAL="${ORCA_OFFICIAL_APPIMAGE:-$HOME/Downloads/Orca.AppImage}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=xos/profile-lock.sh
source "$REPO/xos/profile-lock.sh"

if [[ ! -x "$OFFICIAL" ]]; then
  echo "No official AppImage at $OFFICIAL (set ORCA_OFFICIAL_APPIMAGE)." >&2
  exit 1
fi
if [[ $# -ge 1 && ! -f "$1" ]]; then
  echo "No backup at $1." >&2
  exit 1
fi
if [[ "$(profile_lock_role)" == "desktop" ]]; then
  echo "Orca is still running (it holds $ORCA_PROFILE_LOCK). Quit it completely, then run this again." >&2
  exit 1
fi

# The fork's headless service would otherwise keep the profile now and fight the official build for
# it after every reboot. Rolling forward again: xos/orcad/install.sh.
SERVICE_WAS_ENABLED=0
if systemctl --user is-enabled --quiet "$ORCA_SERVE_UNIT" 2>/dev/null; then
  SERVICE_WAS_ENABLED=1
fi
echo "Stopping and disabling the $ORCA_SERVE_UNIT service..."
systemctl --user disable --now "$ORCA_SERVE_UNIT" 2>/dev/null || true
if ! wait_for_free_profile 20; then
  echo "Something still holds $ORCA_PROFILE_LOCK. Nothing was changed." >&2
  if [[ "$SERVICE_WAS_ENABLED" == 1 ]]; then
    systemctl --user enable --now "$ORCA_SERVE_UNIT" || true
  fi
  exit 1
fi

if [[ $# -ge 1 ]]; then
  mv "$ORCA_PROFILE_DIR" "$ORCA_PROFILE_DIR.fork-$(date '+%Y%m%d-%H%M%S')"
  tar -xzf "$1" -C "$(dirname "$ORCA_PROFILE_DIR")"
  echo "Profile restored from $1 (fork-era profile kept beside it)."
fi

setsid nohup "$OFFICIAL" >/dev/null 2>&1 < /dev/null &
echo "Launched $OFFICIAL"
