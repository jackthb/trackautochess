#!/usr/bin/env bash
set -euo pipefail

: "${VERIFY_TRACK_AUTO_CHESS_STATE_DIR:?Set VERIFY_TRACK_AUTO_CHESS_STATE_DIR to the launch state directory.}"

state_file="$VERIFY_TRACK_AUTO_CHESS_STATE_DIR/state.env"
tmux_config="/exec-daemon/tmux.portal.conf"

listener_pids_for_port() {
  python3 - "$1" <<'PY'
import os
import sys

port = int(sys.argv[1])
inodes = set()
for table in ("/proc/net/tcp", "/proc/net/tcp6"):
    try:
        with open(table, encoding="ascii") as rows:
            next(rows)
            for row in rows:
                fields = row.split()
                if fields[3] == "0A" and int(fields[1].rsplit(":", 1)[1], 16) == port:
                    inodes.add(fields[9])
    except OSError:
        pass

owners = set()
for process in os.scandir("/proc"):
    if not process.name.isdigit():
        continue
    try:
        for fd in os.scandir(f"{process.path}/fd"):
            target = os.readlink(fd.path)
            if target.startswith("socket:[") and target[8:-1] in inodes:
                owners.add(int(process.name))
    except OSError:
        continue

for pid in sorted(owners):
    print(pid)
PY
}

if [[ ! -r "$state_file" ]]; then
  echo "Missing verification state: $state_file" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$state_file"

tmux_cmd=(tmux)
if [[ -f "$tmux_config" ]]; then
  tmux_cmd+=(-f "$tmux_config")
fi

if ! "${tmux_cmd[@]}" has-session -t "=$SESSION" 2>/dev/null; then
  echo "Verification session is not running: $SESSION" >&2
  exit 1
fi

current_pane_pid="$("${tmux_cmd[@]}" display-message -p -t "=$SESSION:0.0" '#{pane_pid}')"
if [[ "$current_pane_pid" != "$PANE_PID" ]]; then
  echo "Session PID changed (expected $PANE_PID, found $current_pane_pid)." >&2
  exit 1
fi

current_pane_pgid="$(ps -o pgid= -p "$PANE_PID" | tr -d '[:space:]')"
current_pane_starttime="$(awk '{ print $22 }' "/proc/$PANE_PID/stat")"
if [[ "$current_pane_pgid" != "$PANE_PGID" || "$current_pane_starttime" != "$PANE_STARTTIME" ]]; then
  echo "Recorded verification process identity no longer matches." >&2
  exit 1
fi

listener_pids="$(listener_pids_for_port "$PORT")"
if [[ -z "$listener_pids" ]]; then
  echo "Nothing is listening on verification port $PORT." >&2
  exit 1
fi

listener_pid="${listener_pids%%$'\n'*}"
if [[ "$listener_pid" != "$LISTENER_PID" ]]; then
  echo "Listener PID changed (expected $LISTENER_PID, found $listener_pid)." >&2
  exit 1
fi

candidate="$listener_pid"
owned=false
while [[ "$candidate" =~ ^[0-9]+$ ]] && (( candidate > 1 )); do
  if [[ "$candidate" == "$PANE_PID" ]]; then
    owned=true
    break
  fi
  candidate="$(awk '/^PPid:/ { print $2 }' "/proc/$candidate/status" 2>/dev/null || true)"
done

if [[ "$owned" != true ]]; then
  echo "Port $PORT belongs to PID $listener_pid, outside session PID $PANE_PID." >&2
  exit 1
fi

listener_cwd="$(readlink -f "/proc/$listener_pid/cwd")"
case "$listener_cwd" in
  "$REPO_ROOT"|"$REPO_ROOT"/*) ;;
  *)
    echo "Port owner runs from $listener_cwd, not $REPO_ROOT." >&2
    exit 1
    ;;
esac

html="$(curl --silent --show-error --fail --max-time 5 "http://127.0.0.1:$PORT/")"
if [[ "$html" != *"Track Dota Auto Chess"* ]]; then
  echo "Port $PORT did not serve the Track Auto Chess build." >&2
  exit 1
fi

echo "doctor=ok"
echo "url=http://127.0.0.1:$PORT"
echo "session=$SESSION"
echo "pane_pid=$PANE_PID"
echo "listener_pid=$listener_pid"
echo "listener_cwd=$listener_cwd"
echo "surface=public-web auth=not-required"
