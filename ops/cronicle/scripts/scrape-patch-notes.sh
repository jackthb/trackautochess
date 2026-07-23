#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
export DAC_REPO_ROOT=${DAC_REPO_ROOT:-/workspace}

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

cd "$DAC_REPO_ROOT"

# This checkout is long-lived and hourly, unlike the Actions runner's fresh
# clone, so start each run from the latest main before scraping — the script
# dedupes against whatever patch files are on disk.
git fetch origin main
git checkout main
git reset --hard origin/main

node scripts/scrape-patch-notes.mjs

if [ -z "$(git status --porcelain -- content/)" ]; then
  echo "No new patch notes."
  exit 0
fi

git config user.name "jackthb"
git config user.email "19895932+jackthb@users.noreply.github.com"
git add content/
git commit -m "Auto-update DAC patch notes and game data from Steam changelog"

if ! git push origin main; then
  echo "Push rejected, rebasing onto latest origin/main and retrying..." >&2
  git fetch origin main
  git rebase origin/main
  git push origin main
fi
