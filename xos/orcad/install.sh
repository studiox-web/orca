#!/usr/bin/env bash
# Install the orcad boot service and the desktop launcher. Safe to re-run.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SHARE="$HOME/.local/share/orca-xos"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DESKTOP="$HOME/.local/share/applications/orca-xos.desktop"

mkdir -p "$SHARE" "$UNIT_DIR"
install -m 0755 "$HERE/orca-xos-serve.sh" "$SHARE/orca-xos-serve.sh"
install -m 0755 "$HERE/orca-xos-desktop.sh" "$SHARE/orca-xos-desktop.sh"
install -m 0644 "$HERE/orca-xos-serve.service" "$UNIT_DIR/orca-xos-serve.service"

# Linger keeps the user manager (and this service) running after logout and from boot.
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]]; then
  loginctl enable-linger "$USER"
fi

# Point the "Orca (XOS)" menu entry at the launcher, which frees the profile for the desktop.
if [[ -f "$DESKTOP" ]]; then
  sed -i "s|^Exec=.*|Exec=$SHARE/orca-xos-desktop.sh %U|" "$DESKTOP"
  update-desktop-database "$(dirname "$DESKTOP")" >/dev/null 2>&1 || true
fi

systemctl --user daemon-reload
systemctl --user enable orca-xos-serve.service
# Starting now is safe while the desktop is open: the service waits until the app quits.
systemctl --user start orca-xos-serve.service
systemctl --user --no-pager status orca-xos-serve.service | head -5
