#!/usr/bin/env bash
# Switch from the official Orca AppImage to this fork's locally built AppImage.
# Run with Orca fully closed (or with --wait=<seconds> to wait for it): it backs up the shared
# profile, installs the newest dist/ AppImage as ~/Applications/Orca-XOS.AppImage, adds a menu
# entry, and launches it. A refused or failed switch leaves the headless service as it found it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP_DIR="$HOME/orca-profile-backups"
TARGET="$HOME/Applications/Orca-XOS.AppImage"
DESKTOP="$HOME/.local/share/applications/orca-xos.desktop"

WAIT_SECONDS=0
for arg in "$@"; do
  case "$arg" in
    --wait=*) WAIT_SECONDS="${arg#--wait=}" ;;
    *) echo "Unknown option $arg" >&2; exit 2 ;;
  esac
done

# shellcheck source=xos/profile-lock.sh
source "$REPO/xos/profile-lock.sh"

# Everything that can refuse happens before the service is touched, so a refused install changes
# nothing: a running desktop keeps its headless standby.
if [[ "$WAIT_SECONDS" -gt 0 && "$(profile_lock_role)" == "desktop" ]]; then
  echo "Waiting up to ${WAIT_SECONDS}s for Orca to close..."
  for ((i = 0; i < WAIT_SECONDS; i++)); do
    [[ "$(profile_lock_role)" == "desktop" ]] || break
    sleep 1
  done
fi
if [[ "$(profile_lock_role)" == "desktop" ]]; then
  echo "Orca is still running (it holds $ORCA_PROFILE_LOCK). Quit it completely, then run this again." >&2
  exit 1
fi

BUILT="$(ls -t "$REPO"/dist/*.AppImage 2>/dev/null | head -1 || true)"
if [[ -z "$BUILT" ]]; then
  echo "No AppImage in $REPO/dist. Build first: xos/build.sh" >&2
  exit 1
fi

# The service holds the profile while the desktop is closed; stop it so the backup is consistent
# and it restarts on the new build. Whatever happens next, it must come back.
SERVICE_STOPPED=0
restart_service() {
  if [[ "$SERVICE_STOPPED" == 1 ]]; then
    echo "Restarting the $ORCA_SERVE_UNIT service..."
    systemctl --user start "$ORCA_SERVE_UNIT" || true
  fi
}
trap restart_service EXIT
if systemctl --user is-active --quiet "$ORCA_SERVE_UNIT" 2>/dev/null; then
  echo "Stopping the $ORCA_SERVE_UNIT service for the switch..."
  systemctl --user stop "$ORCA_SERVE_UNIT"
  SERVICE_STOPPED=1
fi
if ! wait_for_free_profile 20; then
  echo "Something still holds $ORCA_PROFILE_LOCK. Nothing was installed." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR" "$(dirname "$TARGET")" "$(dirname "$DESKTOP")"
STAMP="$(date '+%Y%m%d-%H%M%S')"
echo "Backing up $ORCA_PROFILE_DIR (re-downloadable runtimes and caches excluded)..."
tar -czf "$BACKUP_DIR/orca-profile-$STAMP.tar.gz" -C "$(dirname "$ORCA_PROFILE_DIR")" \
  --exclude='orca/agent-runtimes' --exclude='orca/speech-models' \
  --exclude='orca/Cache' --exclude='orca/Code Cache' --exclude='orca/GPUCache' \
  --exclude='orca/DawnGraphiteCache' --exclude='orca/DawnWebGPUCache' \
  orca
echo "Backup: $BACKUP_DIR/orca-profile-$STAMP.tar.gz"

install -m 0755 "$BUILT" "$TARGET"
cat > "$DESKTOP" <<DESK
[Desktop Entry]
Name=Orca (XOS)
Comment=Orca IDE, Studio X fork build
Exec=$TARGET %U
Icon=$REPO/resources/build/icon.png
Terminal=false
Type=Application
Categories=Development;
MimeType=x-scheme-handler/orca;
DESK
update-desktop-database "$(dirname "$DESKTOP")" >/dev/null 2>&1 || true

LAUNCHER="$HOME/.local/share/orca-xos/orca-xos-desktop.sh"
echo "Launching $TARGET (built from $(git -C "$REPO" rev-parse --short HEAD) on $(git -C "$REPO" branch --show-current))"
if [[ -x "$LAUNCHER" ]]; then
  # The service is installed (xos/orcad/install.sh): the launcher restarts it once the app holds the profile.
  sed -i "s|^Exec=.*|Exec=$LAUNCHER %U|" "$DESKTOP"
  SERVICE_STOPPED=0
  "$LAUNCHER"
else
  setsid nohup "$TARGET" >/dev/null 2>&1 < /dev/null &
fi
