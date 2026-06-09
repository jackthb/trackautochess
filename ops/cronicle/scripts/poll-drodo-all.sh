#!/usr/bin/env sh
set -eu

cd /workspace/web
exec ./node_modules/.bin/tsx scripts/poll-drodo.mts --mode=all
