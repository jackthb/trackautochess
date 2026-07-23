#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${DAC_TOOLS_REPO_DIR:-/home/jack/dac-tools}"
BRANCH="${DAC_TOOLS_GIT_BRANCH:-main}"
REMOTE="${DAC_TOOLS_GIT_REMOTE:-origin}"

cd "$REPO_DIR"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "$BRANCH" ]; then
  echo "Refusing to update: $REPO_DIR is on $current_branch, expected $BRANCH" >&2
  exit 2
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to update: $REPO_DIR has uncommitted changes" >&2
  git status --short
  exit 2
fi

before="$(git rev-parse HEAD)"
git fetch --prune "$REMOTE" "$BRANCH"
target="$(git rev-parse "$REMOTE/$BRANCH")"

if [ "$before" = "$target" ]; then
  echo "dac-tools already up to date at $before"
  exit 0
fi

git merge --ff-only "$target"
after="$(git rev-parse HEAD)"

echo "dac-tools updated: $before -> $after"
echo "Cronicle symlinked scripts now point at the updated checkout."
