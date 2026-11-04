#!/usr/bin/env bash
# Sourced by the switch scripts. The profile lock is the truth about who holds the Orca profile:
# process names are not, because the AppImage runtime and helpers can outlive the app.
ORCA_PROFILE_DIR="${ORCA_USER_DATA_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/orca}"
ORCA_PROFILE_LOCK="$ORCA_PROFILE_DIR/orcad.lock"
ORCA_SERVE_UNIT=orca-xos-serve.service

# Prints the role of a live lock holder (desktop/orcad); nothing when the profile is free.
profile_lock_role() {
  [[ -f "$ORCA_PROFILE_LOCK" ]] || return 0
  local pid role
  pid="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$ORCA_PROFILE_LOCK")"
  role="$(sed -n 's/.*"role":"\([a-z]*\)".*/\1/p' "$ORCA_PROFILE_LOCK")"
  if [[ -n "$pid" && -d "/proc/$pid" ]]; then
    echo "${role:-orcad}"
  fi
}

# Waits up to $1 seconds for the profile to be free; fails if something still holds it.
wait_for_free_profile() {
  local seconds="$1" i
  for ((i = 0; i < seconds * 5; i++)); do
    [[ -z "$(profile_lock_role)" ]] && return 0
    sleep 0.2
  done
  [[ -z "$(profile_lock_role)" ]]
}
