#!/usr/bin/env bash
# Never stop a profile owner from a menu launch: it may have work in flight.
set -euo pipefail

APPIMAGE="${ORCA_XOS_APPIMAGE:-$HOME/Applications/Orca-XOS.AppImage}"
LOCK="${ORCA_USER_DATA_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/orca}/orcad.lock"

refuse() {
  printf 'Orca XOS: %s\n' "$1" >&2
  if [[ "${ORCA_BACKGROUND_LAUNCH:-}" != 1 ]] && command -v notify-send >/dev/null; then
    notify-send 'Orca XOS could not open' "$1" || true
  fi
  exit 75
}

[[ -x "$APPIMAGE" ]] || { printf 'Missing executable: %s\n' "$APPIMAGE" >&2; exit 1; }
if [[ -f "$LOCK" ]]; then
  # JSON parsing and process identity checks fail closed; never delete another owner's lock.
  mode="$(python3 - "$LOCK" <<'PY'
import json, pathlib, sys
try:
    lock = json.loads(pathlib.Path(sys.argv[1]).read_text())
    pid = lock['pid']
    if type(pid) is not int or pid <= 0:
        raise ValueError('invalid pid')
    proc = pathlib.Path('/proc') / str(pid)
    if not proc.exists():
        print('free')
    else:
        boot = pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        ticks = proc.joinpath('stat').read_text().rsplit(')', 1)[1].split()[19]
        if lock.get('bootId') != boot or str(lock.get('linuxStartTicks')) != ticks:
            print('unknown')
        else:
            argv = proc.joinpath('cmdline').read_bytes().split(b'\0')
            print('serve' if b'--serve' in argv or lock.get('role') == 'orcad' else
                  'desktop' if lock.get('role') == 'desktop' else 'unknown')
except (OSError, ValueError, KeyError):
    print('unknown')
PY
)" || refuse 'Cannot verify the profile owner. Existing work was left running.'
  case "$mode" in
    serve) refuse 'The background runtime owns this profile and may have active jobs. Its window can be on a virtual display. Finish or safely stop its work before switching to the desktop; no service was stopped.' ;;
    desktop|free) ;;
    *) refuse 'Cannot verify the profile owner. Existing work was left running.' ;;
  esac
fi

# The profile lock still arbitrates races with the supervisor. Desktop owns the same scheduler.
export ORCA_XOS_LOCAL_SCHEDULER=1
exec "$APPIMAGE" "$@"
