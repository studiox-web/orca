#!/usr/bin/env bash
# Switch from the official Orca AppImage to this fork's locally built AppImage.
# Run with Orca fully closed: it backs up the shared profile, installs the newest
# dist/ AppImage as ~/Applications/Orca-XOS.AppImage, adds a menu entry, and launches it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PROFILE="$HOME/.config/orca"
BACKUP_DIR="$HOME/orca-profile-backups"
TARGET="$HOME/Applications/Orca-XOS.AppImage"
DESKTOP="$HOME/.local/share/applications/orca-xos.desktop"

if pgrep -f '(\.mount_[Oo]rca|Orca(-XOS)?\.AppImage|orca-ide)' >/dev/null; then
  echo "Orca is still running. Quit it completely (File > Quit), then run this again." >&2
  exit 1
fi

BUILT="$(ls -t "$REPO"/dist/*.AppImage 2>/dev/null | head -1 || true)"
if [[ -z "$BUILT" ]]; then
  echo "No AppImage in $REPO/dist. Build first: nvm use 24 && pnpm build:linux" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR" "$(dirname "$TARGET")" "$(dirname "$DESKTOP")"
STAMP="$(date '+%Y%m%d-%H%M%S')"
echo "Backing up $PROFILE (re-downloadable runtimes and caches excluded)..."
tar -czf "$BACKUP_DIR/orca-profile-$STAMP.tar.gz" -C "$HOME/.config" \
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

echo "Launching $TARGET (built from $(git -C "$REPO" rev-parse --short HEAD) on $(git -C "$REPO" branch --show-current))"
setsid nohup "$TARGET" >/dev/null 2>&1 < /dev/null &
