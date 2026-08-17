# Config-file drift audit — 2026-08-09

Checked every config file in the repo against what the codebase actually
contains: `package.json` (root + 3 workspaces), `pnpm-workspace.yaml`, `.npmrc`,
`tsconfig.json` (web + app), `.env.example` (root, `web/`, `ops/cronicle/`),
`.gitignore`, `.vercelignore`, `app/electron-builder.json`, `web/next.config.ts`,
and the four GitHub Actions workflows.

**5 mismatches found**, plus 2 more caught in a 2026-08-16 recheck (see
addendum) — **7 total**. All are stale-entry / version-skew issues; none breaks
a current build. This file is a record only — no config was changed in this
branch.

> **2026-08-16 addendum:** finding 4 below is corrected — three of its five
> `.vercelignore` entries turned out to be live, not stale — and two mismatches
> that were missed on the first pass are added as findings 6 and 7. Details in
> the addendum at the end of this file; the numbered findings above are left as
> originally written for the record, with a pointer at finding 4.

## What checked out clean

Worth stating, because it narrows where the drift is:

- **Every script path referenced from a `package.json` exists** — all 13 root
  `scripts/*.mjs` targets, all 3 `web/scripts/*` targets, both `app/scripts/*`
  targets.
- **Every `shared/package.json` export resolves** — all 19 entries in the
  `exports` map point at a file that exists.
- **Every env var declared in the three `.env.example` files is read somewhere
  in the repo.** No orphaned declarations across all three files.
- **Every file referenced by `app/electron-builder.json` exists** — including
  `main/*.ps1` (matches `find-dota-window-daemon.ps1`), `ipc-channels.cjs`,
  `desktop-paths.cjs`, `scripts/custom-sign.cjs`, and both icon assets.

## Mismatches

### 1. `.gitignore` — dead "Sanity CMS" block

```
# Sanity CMS
cms/node_modules/
cms/.env
cms/.sanity/
cms/dist/
```

There is no `cms/` directory in the repo, and the project uses **Keystatic**,
not Sanity. The only textual hit for "sanity" anywhere in source or docs is the
word "sanity-checks" in `docs/architecture-remediation-plan.md` and the word
"insanity" in a game-lore content file. The whole five-line block is dead.

**Change needed:** delete the block.

### 2. `.gitignore` — leftovers from the removed Python/CV backend

`CLAUDE.md` states the Python/CV backend has been removed. These entries only
ever existed to cover it, and none of the paths exists:

| Entry | Status |
| --- | --- |
| `data/yolo/` | absent — YOLO model dir, CV backend only |
| `*.pt` | no PyTorch weights anywhere in the repo |
| `data/detections.json` | absent |
| `data/crop_debug/` | absent |
| `data/screenshots/` | absent |
| `runs/` | absent — Ultralytics run output |
| `data/debug_*.txt`, `data/filter_*.txt` | absent |

**Keep, do not delete:** `__pycache__/`, `*.pyc`, `.venv/`, and `.uv-cache/`
still earn their place — three Python scripts survive the CV removal
(`data/extract_vpk.py`, `data/extract_icons.py`, `scripts/extract_vscripts.py`).

**Change needed:** drop the seven CV-only entries above; keep the general Python
ones.

### 3. `.gitignore` — `.vercel` listed twice

`.vercel` appears at two separate points in the file (once mid-file, once as the
final line). Harmless but redundant.

**Change needed:** delete one of the two.

### 4. `.vercelignore` — references paths that no longer exist

> **Corrected 2026-08-16 — see addendum.** Three of these five entries are
> live, not stale; only `app/backend/build/` and `app/backend/vendor/` should
> actually be dropped.

```
app/backend/.venv/
app/backend/build/
app/backend/vendor/
tools/presentmon/
presentmon-runs/
```

None of these five directories exists. The first three are Python-backend
artifacts, matching the same removal as finding 2. `tools/presentmon/` and
`presentmon-runs/` are stranger: there is no `tools/` directory at all, and
**"presentmon" has zero references anywhere else in the repo** — no script, no
doc, no workflow. Both entries appear to predate a tooling removal that left no
other trace.

**Change needed:** drop all five. `app/dist/`, `app/release/`, and the
`node_modules`/`.next`/`.vercel` entries in the same file are all still valid
and should stay.

### 5. Node version skew across CI workflows

| File | Node version |
| --- | --- |
| `.github/workflows/release.yml` | `"20"` |
| `.github/workflows/scrape-patch-notes.yml` | `24` |
| `web/package.json` `@types/node` | `^20` |

Two problems here:

- **The two workflows disagree.** Nothing pins a repo-wide Node version — there
  is no `engines` field in any `package.json` and no `.nvmrc`, so each workflow
  picks independently and a local dev environment picks a third thing.
- **Node 20 reached end-of-life in April 2026.** The release workflow — the one
  that builds and publishes the shipped Windows installer — is the one still on
  it.

`packageManager: pnpm@10.32.1` is pinned at the root and `pnpm-lock.yaml` is
`lockfileVersion: '9.0'`, so the pnpm side is consistent; only Node is adrift.

**Change needed:** pick one supported Node major (22 LTS or 24), set it in both
workflows, bump `@types/node` to match, and consider an `engines` field or
`.nvmrc` so the choice is stated in one place.

## Cross-reference

`pnpm-workspace.yaml` also carries two override floors that have fallen below
their advisories' patched versions (`js-yaml: "^4.3.0"`, `dompurify:
"^3.4.12"`). That is genuine config drift, but it is advisory-driven, so it is
written up in `2026-08-09-dependency-advisories.md` rather than duplicated here.

## Addendum — 2026-08-16 recheck

Re-ran this audit as part of the scheduled maintenance run. Findings 1, 2, 3,
and 5 reproduce exactly as written above. Finding 4 needed a correction, and
two mismatches were missed on the first pass.

### Finding 4, corrected — three of the five `.vercelignore` entries are live

"Doesn't exist on disk" was treated as sufficient evidence of staleness, but
that's the *expected* state for an ignore rule covering a generated artifact —
the rule exists so the artifact never gets committed when it does appear.
Three of the five have live producers in the repo:

| Entry | Producer | Verdict |
| --- | --- | --- |
| `tools/presentmon/` | `scripts/capture-dota-fps.ps1:12` — `$presentMon = Join-Path $repoRoot "tools\presentmon\PresentMon.exe"`, throws with "Download it to `tools\presentmon\PresentMon.exe` first" if absent | keep |
| `presentmon-runs/` | same script, `:5` — `[string]$OutputDir = "presentmon-runs"` | keep |
| `app/backend/.venv/` | `data/extract_vpk.py:1168` and `data/extract_icons.py:196` both resolve `app/backend/.venv` as the interpreter to re-exec into | keep |
| `app/backend/build/` | no producer found | drop |
| `app/backend/vendor/` | no producer found | drop |

The original claim that "presentmon" has zero references anywhere in the repo
was the specific error: `scripts/capture-dota-fps.ps1` is that reference. It's
a hand-run Windows FPS-capture harness, so it's invoked by an operator rather
than wired to a `package.json` script — the same category as the other
hand-run operational scripts already known to be intentionally unwired.

Narrowed change: drop only `app/backend/build/` and `app/backend/vendor/` from
`.vercelignore`.

### 6. Missed — `KEYSTATIC_GITHUB_REPO` is an orphaned env declaration

The "What checked out clean" section above claims every `.env.example` var is
read somewhere. There is one exception: `KEYSTATIC_GITHUB_REPO` is declared in
`web/.env.example:21` and documented as required in `docs/README.md:143`, but
nothing reads it — `web/keystatic.config.ts:7` hardcodes
`const githubRepo = "jackthb/dac-tools"`.

Checked whether `@keystatic/*` reads it internally by unpacking both published
tarballs and grepping for env reads:

- `@keystatic/core@0.5.49` reads `KEYSTATIC_GITHUB_APP_SLUG`,
  `KEYSTATIC_GITHUB_CLIENT_ID`, `KEYSTATIC_GITHUB_CLIENT_SECRET`,
  `KEYSTATIC_SECRET`, `KEYSTATIC_CLOUD_API_URL`, `KEYSTATIC_CLOUD_HEADERS`. Not
  `KEYSTATIC_GITHUB_REPO`.
- `@keystatic/next@5.0.4` reads `KEYSTATIC_GITHUB_APP_SLUG`. Not
  `KEYSTATIC_GITHUB_REPO`.

So it's dead in both directions: dead in this repo's code, dead in the
library. It's a real footgun as written — `docs/README.md:143` presents it as
one of five vars required in Vercel for Production, so anyone following that
runbook believes the repo target is configurable when it's actually compiled
in. Changing the repo means editing `keystatic.config.ts`, not the env.

**Change needed:** drop the line from `web/.env.example`, and in
`docs/README.md` either drop it from the block or replace it with a note that
the repo is hardcoded at `web/keystatic.config.ts:7`.

### 7. Missed — `app/package.json` doesn't declare its `@dac/shared` dependency

`app/src` imports `@dac/shared/*` in 8 places (`TrackerHome.tsx`,
`LegendaryPoolOverlay.tsx`, `NetTableSetupCard.tsx`, `backend-events.ts`,
`lib/posthog.ts`, `types.ts`), but `app/package.json` lists no dependency on
the workspace package. `web/package.json` does:
`"@dac/shared": "workspace:*"`.

It builds today only because two separate resolvers are configured by hand —
the `@dac/shared` alias in `app/vite.config.ts:9` and the `@dac/shared/*` path
mapping in `app/tsconfig.json:15`. Nothing is broken, but the manifest doesn't
describe the app's real dependency graph, and the two workspaces disagree on
how the same import is declared.

**Change needed:** add `"@dac/shared": "workspace:*"` to `app/package.json`.
Low priority — worth doing when someone is next in that file.
