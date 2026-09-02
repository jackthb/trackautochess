#!/usr/bin/env bash
set -euo pipefail

: "${VERIFY_TRACK_AUTO_CHESS_STATE_DIR:?Set VERIFY_TRACK_AUTO_CHESS_STATE_DIR to a unique /tmp directory first.}"

repo_root="$(git rev-parse --show-toplevel)"
port="${VERIFY_TRACK_AUTO_CHESS_PORT:-3000}"
state_dir="$VERIFY_TRACK_AUTO_CHESS_STATE_DIR"
state_file="$state_dir/state.env"
log_file="$state_dir/server.log"
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

if [[ -e "$state_file" ]]; then
  echo "Refusing to replace existing verification state: $state_file" >&2
  exit 1
fi

if [[ -n "$(listener_pids_for_port "$port")" ]]; then
  echo "Port $port is already listening; choose another VERIFY_TRACK_AUTO_CHESS_PORT." >&2
  exit 1
fi

mkdir -p "$state_dir"
run_token="$(basename "$state_dir" | tr -c '[:alnum:]_-' '-')"
session="verify-track-auto-chess-${run_token:0:80}"

tmux_cmd=(tmux)
if [[ -f "$tmux_config" ]]; then
  tmux_cmd+=(-f "$tmux_config")
fi

printf -v server_command \
  'exec env PORT=%q pnpm --dir web run dev >%q 2>&1' \
  "$port" "$log_file"

"${tmux_cmd[@]}" new-session -d -s "$session" -c "$repo_root" -- \
  bash -lc "$server_command"

pane_pid="$("${tmux_cmd[@]}" display-message -p -t "=$session:0.0" '#{pane_pid}')"
pane_pgid="$(ps -o pgid= -p "$pane_pid" | tr -d '[:space:]')"
pane_starttime="$(awk '{ print $22 }' "/proc/$pane_pid/stat")"
{
  printf 'REPO_ROOT=%q\n' "$repo_root"
  printf 'PORT=%q\n' "$port"
  printf 'SESSION=%q\n' "$session"
  printf 'PANE_PID=%q\n' "$pane_pid"
  printf 'PANE_PGID=%q\n' "$pane_pgid"
  printf 'PANE_STARTTIME=%q\n' "$pane_starttime"
  printf 'LOG_FILE=%q\n' "$log_file"
} >"$state_file"

for _ in {1..120}; do
  if ! "${tmux_cmd[@]}" has-session -t "=$session" 2>/dev/null; then
    echo "Track Auto Chess exited before becoming ready. Log: $log_file" >&2
    exit 1
  fi

  if curl --silent --fail --max-time 2 "http://127.0.0.1:$port/" |
    grep -q "Track Dota Auto Chess"; then
    listener_pids="$(listener_pids_for_port "$port")"
    listener_pid="${listener_pids%%$'\n'*}"
    if [[ ! "$listener_pid" =~ ^[0-9]+$ ]]; then
      echo "Could not identify the process listening on port $port." >&2
      exit 1
    fi
    printf 'LISTENER_PID=%q\n' "$listener_pid" >>"$state_file"
    echo "Track Auto Chess ready at http://127.0.0.1:$port"
    echo "State: $state_file"
    echo "Log: $log_file"
    exit 0
  fi
  sleep 0.5
done

echo "Timed out waiting for Track Auto Chess. Log: $log_file" >&2
exit 1
