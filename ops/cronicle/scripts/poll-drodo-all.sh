#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
export DAC_REPO_ROOT=${DAC_REPO_ROOT:-/workspace}

for env_file in \
  "$SCRIPT_DIR/../.env" \
  /workspace/ops/cronicle/.env \
  "$DAC_REPO_ROOT/ops/cronicle/.env"
do
  if [ -f "$env_file" ]; then
    set -a
    . "$env_file"
    set +a
    break
  fi
done

exec node "$SCRIPT_DIR/poll-drodo.mjs" --mode=all "$@"
