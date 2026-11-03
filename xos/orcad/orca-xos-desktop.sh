#!/usr/bin/env bash
# Open the Orca (XOS) desktop app when the headless service may hold the profile.
# The desktop and orcad share one profile lock, so: stop the service, launch the app,
# wait for the app to take the lock, then start the service again. The service waits in
# standby while the app runs and takes over the scheduler within a minute of the app quitting.
set -uo pipefail

APPIMAGE="${ORCA_XOS_APPIMAGE:-$HOME/Applications/Orca-XOS.AppImage}"
LOCK="${ORCA_USER_DATA_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/orca}/orcad.lock"
UNIT=orca-xos-serve.service

lock_role() {
  # Prints the role of a live lock holder (desktop/orcad), or nothing when the lock is free.
  [[ -f "$LOCK" ]] || return 0
  local pid role
  pid="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$LOCK")"
  role="$(sed -n 's/.*"role":"\([a-z]*\)".*/\1/p' "$LOCK")"
  [[ -n "$pid" && -d "/proc/$pid" ]] && echo "${role:-orcad}"
}

if [[ "$(lock_role)" == "desktop" ]]; then
  # Already open: hand the activation to the running app.
  exec "$APPIMAGE" "$@"
fi

if systemctl --user is-active --quiet "$UNIT"; then
  systemctl --user stop "$UNIT"
fi
for _ in $(seq 1 100); do
  [[ -z "$(lock_role)" ]] && break
  sleep 0.2
done

setsid nohup "$APPIMAGE" "$@" >/dev/null 2>&1 </dev/null &

# Restart the service only once the desktop owns the lock, so the two never race for it.
(
  for _ in $(seq 1 300); do
    if [[ "$(lock_role)" == "desktop" ]]; then
      systemctl --user start "$UNIT"
      exit 0
    fi
    sleep 0.5
  done
  # The app never took the lock (closed or failed): bring the scheduler back anyway.
  systemctl --user start "$UNIT"
) >/dev/null 2>&1 &
disown
