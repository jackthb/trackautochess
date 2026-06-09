#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

for env_file in \
  "$SCRIPT_DIR/../.env" \
  /workspace/ops/cronicle/.env \
  /home/jack/dac-tools/ops/cronicle/.env
do
  if [ -f "$env_file" ]; then
    set -a
    . "$env_file"
    set +a
    break
  fi
done

exec node "$SCRIPT_DIR/poll-drodo.mjs" --mode=all "$@"
