# Documentation drift audit — 2026-08-16

Checked the prose documentation against what the codebase actually contains:
`CLAUDE.md`, `AGENTS.md`, `docs/*.md` (11 files), `ops/cronicle/README.md`,
`ops/insomnia/README.md`, and `scripts/build-guides/README.md`.

**1 correction applied** (in this branch). Everything else checked out.

## Correction applied

### `AGENTS.md` — "Known pre-existing test failure" was stale

The section told every agent working in this repo that `cargo test` in
`app/backend/` fails on a clean checkout, on
`nettable_service::tests::parity_events_emit_round_creep_and_personal_elimination`.

That is no longer true. `cargo test` on `main` (ed34d3d) in this environment:

```
test result: ok. 75 passed; 0 failed; 1 ignored   (unit)
test result: ok.  1 passed; 0 failed              (nettable_daemon)
test result: ok.  1 passed; 0 failed              (nettable_golden)
```

The named test passes. PR [#317](https://github.com/jackthb/dac-tools/pull/317)
independently reported "77 passed, 0 failed" in its validation notes on
2026-08-06, so the failure was already gone before this audit.

The cost of leaving it is real: a stale "known failure" note trains anyone
reading it to wave through a genuine regression in that exact test. The section
is rewritten to record the green state and to say that a failure there is now a
real regression.

## Checked and clean

- **Rust backend CLI.** All 12 commands documented in `CLAUDE.md` / `AGENTS.md`
  (`daemon`, `parse-log`, `parse-log-full`, `parse-live`, `queue`,
  `outbox-list`, `outbox-flush`, `gsi-cfg`, `finalize-log`, `finalize-dump`,
  `timeline-from-log`, `timeline-from-dump`) match the dispatch table in
  `app/backend/src/main.rs` exactly — no extras, no omissions.
- **Every documented `npm run` / `pnpm run` command exists.** All 29 distinct
  invocations across all Markdown files resolve to a real script in the root,
  `app/`, or `web/` `package.json`.
- **Every documented API route exists.** All `/api/...` paths referenced in docs
  resolve to a `route.ts` under `web/app/api/`.
- **Every repo-relative file path referenced in docs exists**, once generated
  and gitignored outputs are accounted for (`web/generated/content-data.ts` is
  produced by the `predev`/`prebuild` hook; `data/vscripts/` and
  `scripts/build-guides/cache/` are deliberately uncommitted third-party
  content).
- **The deleted `refresh-queens.yml` workflow is already documented as
  deleted** — `docs/README.md:130` was updated in the same commit that removed
  it (ed34d3d). No drift.
- **Workflow schedules match the docs.** `poll-drodo.yml` and
  `scrape-patch-notes.yml` are both `workflow_dispatch`-only, exactly as
  `docs/README.md` and `CLAUDE.md` describe, and the Cronicle patch-notes job is
  on `17 * * * *` — the "hourly" the docs claim.
- **`docs/architecture-remediation-plan.md` is not drifted, despite naming files
  that do not exist** (`app/main/supabase-ipc.cjs`, `supabase/queries.rs`,
  `app/backend/src/steam_setup.rs`, `app/src/lib/game-utils.ts`). The document
  declares itself history at the top ("Read the phase sections below as history,
  not as instructions") and annotates each divergence inline — e.g. "shipped as
  `nettable_setup.rs`; no `steam_setup.rs` exists". It is already correct about
  being out of date.
- **The "no ESLint config or `lint` script" note in `AGENTS.md` still holds** —
  no `.eslintrc*`, no `eslint.config.*`, and no `eslint` dependency in any of
  the four `package.json` files.

## Noted, not changed

`CLAUDE.md` and `AGENTS.md` are near-identical twins that have diverged in two
places. Neither is wrong, but the drift will widen:

- `AGENTS.md` carries a **Steam ID helpers** convention (reuse `shared/steam.ts`
  / the `supabase/mod.rs` helpers rather than re-implementing conversion) that
  `CLAUDE.md` does not.
- On Supabase Storage, `AGENTS.md` adds "remote raw dump uploads were removed on
  2026-07-02"; `CLAUDE.md` still describes the backend as handling
  "diagnostic/raw-log uploads". Both files agree elsewhere that raw nettable
  dumps stay local, and the backend does still upload `tracker.log` and
  `console.log` to the `diagnostic-logs` bucket
  (`app/backend/src/supabase/diagnostics.rs`), so `CLAUDE.md` is defensible as
  written — just less precise.

Left alone because deciding whether these two files should be kept in sync (or
one made a pointer to the other) is a judgement call for the repo owner, not an
audit finding.
