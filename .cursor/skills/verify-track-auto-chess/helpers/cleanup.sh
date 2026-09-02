#!/usr/bin/env bash
set -euo pipefail

: "${VERIFY_TRACK_AUTO_CHESS_STATE_DIR:?Set VERIFY_TRACK_AUTO_CHESS_STATE_DIR to the launch state directory.}"

state_dir="$VERIFY_TRACK_AUTO_CHESS_STATE_DIR"
state_file="$state_dir/state.env"
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
if inodes and not owners:
    print("unknown")
PY
}

if [[ ! -r "$state_file" ]]; then
  echo "No verification state remains at $state_file"
  exit 0
fi

# shellcheck disable=SC1090
source "$state_file"

tmux_cmd=(tmux)
if [[ -f "$tmux_config" ]]; then
  tmux_cmd+=(-f "$tmux_config")
fi

listener_pid="${LISTENER_PID:-}"
owned_group=false
if kill -0 "$PANE_PID" 2>/dev/null; then
  current_pane_pgid="$(ps -o pgid= -p "$PANE_PID" | tr -d '[:space:]')"
  current_pane_starttime="$(awk '{ print $22 }' "/proc/$PANE_PID/stat")"
  if [[ "$current_pane_pgid" != "$PANE_PGID" || "$current_pane_starttime" != "$PANE_STARTTIME" ]]; then
    echo "Refusing cleanup: recorded verification process identity changed." >&2
    exit 1
  fi
  owned_group=true
fi

if [[ -n "$listener_pid" ]] && kill -0 "$listener_pid" 2>/dev/null; then
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
    echo "Refusing cleanup: listener PID $listener_pid is not owned by pane PID $PANE_PID." >&2
    exit 1
  fi
  owned_group=true
fi

if "${tmux_cmd[@]}" has-session -t "=$SESSION" 2>/dev/null; then
  current_pane_pid="$("${tmux_cmd[@]}" display-message -p -t "=$SESSION:0.0" '#{pane_pid}')"
  if [[ "$current_pane_pid" != "$PANE_PID" ]]; then
    echo "Refusing to stop $SESSION: expected pane PID $PANE_PID, found $current_pane_pid." >&2
    exit 1
  fi
  "${tmux_cmd[@]}" kill-session -t "=$SESSION"
fi

if [[ "$owned_group" == true ]] && kill -0 -- "-$PANE_PGID" 2>/dev/null; then
  kill -TERM -- "-$PANE_PGID"
  for _ in {1..50}; do
    if ! kill -0 -- "-$PANE_PGID" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
fi

if [[ -n "$(listener_pids_for_port "$PORT")" ]]; then
  echo "Port $PORT still listens after stopping recorded PID $listener_pid." >&2
  exit 1
fi

rm -rf -- "$state_dir"
echo "cleanup=ok session=$SESSION"
echo "Evidence under /opt/cursor/artifacts was not touched."
