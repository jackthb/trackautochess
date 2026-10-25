# Weekly Workshop entity refresh

Refresh Workshop item `1613886175` for Dota 2 (`570`) in an isolated checkout,
then open or update a draft PR for review. Do not auto-merge or set a patch's
`entitiesSynced` flag to `true`.

## Scheduled GitHub Actions refresh

`.github/workflows/workshop-refresh.yml` runs every 6 hours (`0 */6 * * *`)
and on `workflow_dispatch`. Dispatch works once the workflow file is on the
default branch. The job runs on a GitHub-hosted `ubuntu-latest` runner.

Each run asks Steam for the published-file `time_updated` of Workshop item
`1613886175` before it downloads anything. When that value matches
`data/workshop-last-seen.json` on the default branch or on
`workshop-data-refresh`, the run exits without downloading the VPK. A record
written before `time_updated` was stored still matches when its manifest id
equals the published `hcontent_file`.

When the publish is new, the run anonymously downloads the Workshop VPK with
DepotDownloader 3.4.0 (`-app 570 -pubfile 1613886175`, no Steam username).
The release zip and the binary inside it are pinned by sha256, as are `vpk`
and pnpm. It reads the manifest id from the downloader log line
`Manifest <id> (<CreationTime>)`. The scheduled job does not install a browser.

The last-seen record is `data/workshop-last-seen.json`. A missing file means
no manifest has been recorded yet. A successful `refresh-workshop.py` run
writes this file, including `time_updated`, and does not commit it. The
workflow's publish job commits it.

- The same publish as the default branch, or the same publish as an open
  refresh PR: no-op. No download, no commit, and no pull request update.
- A closed pull request already covers this manifest: leave it closed. Do not
  open or reopen one.
- The fixed branch already has that manifest but there is no open or closed
  PR: open a draft PR for the existing branch. Do not extract again.
- Any other manifest: run `python scripts/refresh-workshop.py --full-checks`,
  commit the content and icon result plus `data/workshop-last-seen.json` onto
  `workshop-data-refresh`, and open or update one draft pull request.

Every publish starts from current `main` and adds one commit, including when
a draft pull request is already open. The generated paths in that commit are
the new refresh output. The job does not three-way-merge that output onto the
previous refresh commit. If the data branch is a fast-forward, the update is a
normal push. Otherwise the update is `git push --force-with-lease` only when
every commit the lease replaces was both authored and committed by
`github-actions[bot]`. An amend, rebase, or cherry-pick that leaves the bot as
author and a person as committer stops the job. Merge or close the pull
request, or remove the non-bot commit, then rerun. The branch stays where it
is. The lease moves the branch ref. The previous tip leaves the branch, and
GitHub may garbage-collect it.

The committed diff is `content/` except `content/patch-notes/`, `data/icons/`,
and `data/workshop-last-seen.json`. A patch-note push that lands on `main`
during the run stays. A symlink in that diff is rejected. A last-seen change
that only updates `recorded_at` does not create a commit.

The pull request body includes the `report.json` summary, entity and icon count
changes, and every Steam changelog entry posted after the previously recorded
`time_updated` and through the current one. Consecutive posts with the same
excerpt share one bullet. If Steam blocks the runner, the emit retries through
the r.jina.ai reader and then the matching entries already saved in
`content/patch-notes`. That saved list is labeled in the body, because a newer
post may be missing. If that emit fails, the error is in the pull request
body. The workflow does not install a browser to retry it.
The workflow never merges and never sets `entitiesSynced`. The VPK and
extracted Lua stay in the runner temp directory and are deleted before the
job ends. They are not uploaded as artifacts.

Checkouts use `persist-credentials: false`. Each job runs `gh auth setup-git`
with that job's token before its first `git fetch`. The prepare job can read
the repository and list pull requests. The publish job can push and open a
pull request. Artifact upload and download use the Actions runtime token, so
neither job sets an `actions` permission. Publish checks out full history
(`fetch-depth: 0`).

No Steam account and no extra repository secret are required. Opening the pull
request works only when the repository setting **Allow GitHub Actions to create
and approve pull requests** is enabled (Settings → Actions → General). Enable
that before merging this workflow, or every scheduled run that finds a new
manifest will fail at the draft-PR step. Also enable **Automatically delete
head branches** (Settings → General) so a squash-merged refresh branch does
not pile up. `workshop-data-refresh` does not need to be deleted. The next run
rebuilds it from current `main` when every commit on it was authored and
committed by the bot. A lease moves the branch ref off the previous tip.

The manual steps below are the same refresh the workflow invokes.

## One-command refresh (no Steam client)

In a clean dedicated checkout with Python 3.11+ and Node/npm installed:

```sh
python -m pip install vpk
python scripts/refresh-workshop.py
```

The script downloads the pinned DepotDownloader 3.4.0 executable for the host
(including Raspberry Pi Linux ARM/ARM64) and rejects the zip unless its sha256
matches the pin in the script. It anonymously downloads the latest
Workshop VPK, unpacks readable Lua for review, snapshots maintained content,
runs extraction and runtime generation twice, checks preservation and
determinism, then runs the extractor tests. It does not require the Steam
client, a running game, a Steam account or an AI API key. On success it writes
`data/workshop-last-seen.json` and still does not commit.

Use an existing Python virtual environment if the OS disallows system pip
installs. Run `pnpm install --frozen-lockfile` and add `--full-checks` for the
synergy, patch-note and web TypeScript checks. To download only, with no
Python packages or Node required:

```sh
python scripts/refresh-workshop.py --download-only
```

`--depot-downloader /path/to/DepotDownloader` uses an existing binary instead
of downloading it. `--cache-dir /path/to/cache` changes the default
`~/.cache/dac-tools/workshop`. Each run retains a fresh download, original
downloader/version logs, VPK hash, unpacked Lua, before-snapshots and
`report.json`. Keep the download log for source manifest/UGC provenance.
Remove old `run-*` directories after review to reclaim disk space; the script
does not delete evidence automatically. A cache lock prevents overlapping
runs; remove a stale `refresh.lock` directory only after confirming no run
is active. Failed validation leaves the diff and snapshots available for
inspection, returns nonzero and never publishes changes. It never marks a
patch synced. Source-mechanics review stays on the draft pull request. The
workflow opens that pull request and does not merge it.

The host still needs outbound network access to GitHub releases and Steam's
content services. The Steam client itself is not needed. Do not schedule
against the patch scraper's shared resettable checkout.

## Execution host and prerequisites

The scheduled job is the supported hosted run. A manual run needs Python with
`vpk` installed, Node, the repository's pinned pnpm version, Git, and
authenticated GitHub PR access when a person is opening the pull request.
Anonymous DepotDownloader is enough for the VPK; a Steam client login is not
required. Follow the current `AGENTS.md`.

The existing Pi Cronicle job scrapes patch notes hourly. It does not download
or extract the VPK, and it pushes directly to `main`. Keep this refresh in a
separate checkout/worktree so the hourly scraper cannot touch its working
changes. Do not repurpose the parked Drodo jobs.

Use a verified DepotDownloader release suitable for the host. PR #348 reports
using 3.4.0; that is provenance for the prior run, not a guarantee of current
availability. Pin and record the version and binary checksum used for each
run. Official command reference:
<https://github.com/SteamRE/DepotDownloader#usage>.

If Steam downloads, required dependencies, or the execution host are
unavailable, report the exact blocker and stop the refresh. Do not present a
review of existing JSON or an old cached VPK as a fresh extraction.

## Download and record provenance

Start from current `origin/main`, record its SHA, and check for an existing
open refresh PR before creating another. Use a clean, dedicated worktree and
a run directory outside tracked paths. Set `DAC_WORKSHOP_CACHE` to a cache
directory and download anonymously:

```sh
DepotDownloader -app 570 -pubfile 1613886175 -dir "$DAC_WORKSHOP_CACHE" -validate
```

The published-file ID resolves the current UGC. Do not pin the September 10
manifest from #348 as the source for future weekly runs. Record the actual
resolved manifest/UGC, Workshop update time if available, download time in
UTC, VPK filename, size and SHA-256, and extractor commit. Verify that the
download completed and the archive is readable before modifying content.
Resolve the downloaded VPK path explicitly; do not assume DepotDownloader
uses the Steam client's directory layout. Set `DAC_VPK` to that absolute path.

## Unpack VScripts and inspect gameplay changes

A VPK is an archive. `scripts/extract_vscripts.py` unpacks its Lua/VScript
bytes; it does not decompile Lua bytecode. The extractor reads
`scripts/vscripts/addon_game_mode.lua` as UTF-8 source. Inspect the required
members before extraction. If they contain compiled bytecode or an
unsupported encoding, identify the format and use a compatible, verified
decompiler locally, retaining the original bytes and provenance. Do not
execute the game scripts. If decoding cannot be verified, stop rather than
feed replacement-character text into the entity extractor. Its current API
does not accept a separate decompiled-Lua directory; supporting that input
would need a reviewed extractor change.

For an explicit downloaded VPK, the checked-in VScript helper can be called
without relying on its Steam installation discovery:

```sh
python -c 'import os; from pathlib import Path; from scripts.extract_vscripts import extract; print(extract(Path(os.environ["DAC_VPK"])))'
```

Export `DAC_VPK` before that command. The helper writes `data/vscripts/` and
rotates an existing extraction into `data/vscripts_prev/`. Preserve the prior
verified extraction in a private cache between runs; a fresh checkout has no
previous version to compare. Use `local_diff()` from the same helper or
`git diff --no-index` for the local review (exit status 1 means differences).
Keep extracted Lua, VPKs, decompiler output and full script diffs out of Git
and public PR attachments, as required by `.gitignore`.

## Refresh and validate

Before extracting, snapshot the committed `content/` and `data/icons/`
outside the worktree. Run against the existing content so manually maintained
fields and text corrections are available. Do not extract to an empty
`--out` directory and then overwrite the maintained collection.

```sh
python data/extract_vpk.py "$DAC_VPK"
python -m unittest discover -s data -p 'test_extract_vpk.py'
npm run web:data
npm run test:synergies
npm run test:patch-notes
npm run validate:patch-notes
pnpm --dir web exec tsc --noEmit
```

Run the entity extraction and runtime generator again against the identical
VPK. Compare both passes' tracked content, icon assets, entity-index files
and generated runtime output byte-for-byte; the second pass must introduce
no new changes. `git diff --exit-code` against `main` alone is not a
determinism check because a valid refresh intentionally differs from main.

Compare all existing records' `overrides`, commentary and relationships with
the pre-run snapshot. Verify curated item tiers/links, aliases, text
corrections, supplemental relic records, and tier-zero rewards explicitly.
Some files, including aliases, are regenerated, so flag differences rather
than assuming they were preserved. Flag deletions or unexpected count drops.
Check all unit-to-ability references, pool references, new icon paths and
patch links; distinguish missing source mappings from broken references.
The icon extractor skips existing files, so review changed source icons
explicitly instead of assuming the refresh updates them.

Review source changes in separate bounded passes for extraction/parser
correctness, preserved human content, and gameplay/translation accuracy.
Cross-check pending patch notes against actual source values. Do not treat
tooltip text alone as proof of gameplay behavior. Initial unresolved cases
from #348 include Puck's ability naming, Faceless Void's ability name,
Compass/IO mechanics, Mech probabilities, Aqir timing, and the additional
Largo, Terrorblade and Assassin changes. Reassess these against the current
source rather than assuming they remain unchanged forever.

Run the web viewer and inspect changed entity details, new icons, and patch
links when browser execution is available. Report unavailable checks
separately from passed checks.

## Review output

On a verified no-change run, report the source identity and checks performed;
do not create an empty PR. On changes, open or update one draft refresh PR
with provenance, entity/count changes, preservation results, deterministic
validation, test results and unresolved gameplay questions. Include only
intended content/assets, generated index changes, and reviewed fixes.
Separate parser or UI fixes from unexplained generated-data churn where
practical. Leave pending patches unsynced and request Jack's review. Never
push refresh changes directly to `main` or merge them automatically.
