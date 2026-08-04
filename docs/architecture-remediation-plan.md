# Architecture Remediation Plan

Step-by-step instructions for fixing the findings from the June 2026 architectural review.
Work through the phases in order — each phase leaves the repo shippable, and later phases
assume the earlier ones are done. Validate after every phase with the checks listed.

## Current status (2026-08-02)

| Phase | Status | Branch / PR | Notes |
| --- | --- | --- | --- |
| Phase 1 | Merged to `main` | [#229](https://github.com/jackthb/dac-tools/pull/229) | Desktop Drodo profile query fix |
| Phase 2 | Merged to `main` | [#230](https://github.com/jackthb/dac-tools/pull/230) | Electron main modularization |
| Phase 3 | Merged to `main` | [#234](https://github.com/jackthb/dac-tools/pull/234) | Desktop data routed through Rust backend |
| Phase 4 | Merged to `main` | [#232](https://github.com/jackthb/dac-tools/pull/232) | Backend module split |
| Phase 5 | Merged to `main` | `codex/phase-5-typed-contracts-v2` | `app/src/backend-events.generated.ts` is committed; `npm run generate:ipc-types` regenerates it |
| Phase 6 | Merged to `main` | #264 | `shared/drodo-core.mjs` + `.d.mts` are committed; `npm run build:drodo-core` / `test:drodo-core` are wired up |
| Phase 7 | Not started | no PR | Requires live-game fixture capture. The only open item. |

**Read the phase sections below as history, not as instructions.** Phases 1–6
have shipped, and several shipped differently from what is written here — where
they diverge, the code is right and this document is the record of intent.
Divergences worth knowing about are called out inline.

---

## Phase 1 — Fix the broken desktop Drodo feature (bug, ~1 hour)

**Problem:** `app/main.js` still queries and upserts the `drodo_profiles` table
(`drodo:fetch` around line 935, `drodo:refresh` around line 1019), but that table was
dropped by `supabase/migrations/20260429120000_merge_drodo_profiles_into_users.sql`.
The data now lives on `users`. The desktop MMR/profile panel silently returns nothing.

**Steps:**

1. Open `app/main.js` and find the `drodo:fetch` handler.
2. Replace the `rest/v1/drodo_profiles?select=...` query with the equivalent `users`
   query. Check `web/lib/drodo.ts` for the canonical column names on `users`
   (the merge migration renamed/relocated columns — e.g. `mmr`, `max_mmr`, `mmr_level`,
   `season`, `season_games`, `chicken_count`, `drodo_fetched_at`). Match what the web
   app reads; do not guess.
3. In the `drodo:refresh` handler, replace the `drodo_profiles` upsert with an upsert
   to `users` (again mirroring `web/lib/drodo.ts` / `shared/drodo-core` payload shape —
   `drodoProfileToUserPayload` in `shared/drodo-core.ts` already builds this payload;
   use it instead of hand-rolling the field mapping).
4. While there: make the failure loud. Both handlers currently swallow errors into
   `console.error` and return `null`. At minimum, return `{ error: string }` so the
   renderer can show "couldn't load profile" instead of an empty panel.
5. **Validate:** run `npm run dev:desktop`, sign in, and confirm the MMR/profile panel
   populates. Then rename the table in the URL to something bogus and confirm the UI
   now shows an error instead of silently rendering empty.

> Note: Phase 3 deletes these handlers from `main.js` entirely and moves them into the
> Rust backend. Do Phase 1 anyway — it's an hour, it unbreaks the shipped app now, and
> the corrected query is the spec for the Rust implementation.

---

## Phase 2 — Modularize `app/main.js` (~half a day)

**Problem:** `main.js` is ~1160 lines mixing updater, backend process supervision,
replay file management, content readers, Supabase/Drodo fetching, protocol handling,
and window management, with ~15 module-level mutable globals.

**Steps:**

1. Create `app/main/` and move code out of `main.js` in this order (each is a
   self-contained commit; the app must boot after each one):
   - `app/main/updater.cjs` — `parseSemver`, `isNewerVersion`, `fetchJson`,
     `checkForUpdate`, the update-check interval, and `GITHUB_RELEASES_API`.
     **Shipped differently:** the hand-rolled GitHub Releases API poller was
     replaced rather than moved. `updater.cjs` exports a single
     `createUpdater({ isPackaged, emitEvent })` and delegates to
     `electron-updater`, keeping only `UPDATE_CHECK_INTERVAL_MS` and
     `MAX_UPDATE_ERROR_MESSAGE_LENGTH`. None of the identifiers named above
     exist.
   - `app/main/backend-supervisor.cjs` — backend spawn/restart/readline plumbing
     (`backendProcess`, `backendRL`, `backendRestarting`, `backendRestartTimer`,
     `backendWatchers`), exposing `start()`, `stop()`, `send(cmd)`, and an
     `onEvent(cb)` subscription. All `tracker:*` IPC wiring stays in `main.js` but
     calls this module.
   - `app/main/replays.cjs` — the `replays:*` IPC handler implementations.
   - `app/main/content.cjs` — `CONTENT_DIR` readers behind the `data:*` handlers and
     `runtimeGameDataCache`.
   - `app/main/supabase-ipc.cjs` — the `games:*`, `timelines:*`, `drodo:*` handlers
     (temporary home; Phase 3 deletes this file).
2. Pass dependencies in explicitly (paths object, `getMainWindow()` accessor) rather
   than importing `main.js` back — keep the dependency direction one-way.
3. `main.js` should end up ~200 lines: app lifecycle, window creation, single-instance
   lock, menu, and `ipcMain` registrations that delegate to the modules.
4. Do **not** rename IPC channel names in this phase — renderer compatibility stays
   untouched, so this is a pure move.
5. **Validate:** `npm run dev:desktop` — check window controls, tab navigation, replay
   list, history tab (games fetch), log tab, and that killing the backend process
   triggers a restart. Then `npm run build:desktop:installer:dir` to confirm
   electron-builder still packages (the new files must be inside `app/`, which they are).

---

## Phase 3 — Single Supabase client: route desktop data access through the Rust backend (~2–3 days)

**Problem:** Three independent Supabase clients exist (Rust `supabase.rs`, Electron
`main.js` raw REST, web supabase-js). The Electron one is the unowned path that rotted
(Phase 1's bug). The Rust backend already has config, retry/outbox, and the IPC channel.

**Steps:**

1. In `app/backend/src/ipc_events.rs`, define typed response events for the data the
   renderer needs: `GamesList`, `MatchTimeline`, `DrodoProfile` (derive `TS` like the
   existing events so they land in `backend-events.generated.ts`).
2. In the Rust daemon command dispatch (`run_daemon` in `main.rs`), add commands:
   - `fetch_games` → query `matches`/`match_players` (the queries `main.js`
     `games:fetch` does today) → emit `GamesList`.
   - `fetch_timeline { match_id }` → emit `MatchTimeline`.
   - `update_game { id, fields }` → patch + emit confirmation.
   - `fetch_drodo` / `refresh_drodo` → port the (Phase-1-corrected) logic; the
     Drodo API call (`autochess.ppbizon.com/courier/get/@{steam_id}`) and the
     `users` upsert both move here. Reuse `supabase.rs` request helpers; put the new
     queries in a new `supabase/queries.rs` or alongside the existing domain fns —
     do not add a second HTTP client.
3. Run `npm run generate:ipc-types` and commit the regenerated
   `app/src/backend-events.generated.ts`.
4. In the renderer, change `useGames.ts`, `useDrodo.ts`, and the timeline hook to send
   tracker commands and listen for the typed events instead of calling
   `window.appApi.fetchGames()` etc. Keep `preload.js`'s generic
   `tracker.sendCommand`/`onEvent` as the only transport.
5. Delete `app/main/supabase-ipc.cjs` (from Phase 2), the corresponding
   `ipcMain.handle` registrations, and the now-unused entries in `preload.js`
   (`fetchGames`, `fetchTimeline`, `updateGame`, `fetchDrodo`, `refreshDrodo`).
6. Decide on `loadTrackerConfig` in Electron: after this phase, `main.js` should no
   longer need `supabase_url`/`supabase_key` from `~/.dac/config.json`. If nothing
   else in Electron reads the config, delete the reader; one writer (Rust) remains.
7. **Validate:** dev-run the app: history tab loads games, timeline panel renders,
   Drodo refresh updates MMR. Kill networking mid-refresh and confirm the error
   surfaces in the UI. Run `cargo test --manifest-path app/backend/Cargo.toml`.

---

## Phase 4 — Split `nettable_service.rs` (82KB) and `supabase.rs` (52KB) (~1–2 days)

**Problem:** `nettable_service.rs` contains at least four concerns; `supabase.rs`
mixes several upload domains. Do this **before** the planned per-key storage-filter
feature, which would otherwise land in the same giant file.

**Steps (pure moves — no behavior changes, no signature changes beyond visibility):**

1. Create `app/backend/src/steam_setup.rs` — **shipped as `nettable_setup.rs`**;
   no `steam_setup.rs` exists, and the similarly-named `steam_auth.rs` is a
   different module (Steam OpenID login). `is_dota_running` ended up in
   `nettable_service.rs` and `steam_id64_to_account_id` in `supabase/mod.rs`.
   Move Steam/Dota environment discovery and
   mutation — `find_dota_dir`, `find_console_log`, `is_dota_running`,
   `is_steam_running`, `process_running`, `request_steam_shutdown`,
   `candidate_steam_dirs`, `find_localconfig_vdf`, `localconfig_has_dota`,
   `find_app_block_bounds`, `find_dota_launch_options`, `find_launch_options_value`,
   `tokenize_launch_options`, `apply_dota_launch_options*`, `LaunchOptionsValue`,
   `LaunchOptionsApplied`, `steam_id64_to_account_id`, `find_gsi_cfg_target`,
   `install_gsi_cfg`, and the setup progress/error JSON helpers.
2. Create `app/backend/src/match_builder.rs`: move the pure payload-construction
   functions — `build_match_timeline`, `own_player_payload`,
   `extract_round_from_rows`, `extract_draft_state_from_rows`,
   `extract_death_team_from_rows`, `detect_personal_elimination`,
   `roster_steam_ids`, `table_names`, `latest_ui_state`, `is_match_end_transition`.
3. Keep `nettable_service.rs` as the stateful orchestrator: `NettableService`,
   `NettableState`, polling, hotkey firing, finalization flow, dump persistence,
   queen-ladder trigger.
4. Split `supabase.rs` into a module directory: `supabase/mod.rs` (client + request
   helpers + auth headers), `supabase/matches.rs`, `supabase/diagnostics.rs`,
   `supabase/queen_ladder.rs` (and `supabase/queries.rs` from Phase 3).
5. One commit per extracted module; after each, `cargo build` + `cargo test` +
   `cargo clippy` must pass with no new warnings.
6. **Validate:** `cargo test --manifest-path app/backend/Cargo.toml` (golden fixture
   test still passes), then a dev-run smoke check that setup/launch-options apply
   still works (`nettable_apply_launch_options` over IPC).

---

## Phase 5 — Extend typed contracts to commands and config (~1 day)

**Problem:** Events are generated (`backend-events.generated.ts`), but the other half
of each boundary is stringly typed: `tracker:command` payloads, the `ipcMain.handle`
channel names, and the `~/.dac/config.json` shape (read/written by both Rust and JS
with no shared schema).

**Steps:**

1. In the Rust backend, define a `BackendCommand` enum (serde-tagged, matching the
   strings Electron currently sends) covering every command `run_daemon` parses,
   including the Phase 3 additions. Derive `TS` and add it to the binding-export test
   so it lands in `backend-events.generated.ts` (or a sibling
   `backend-commands.generated.ts`).
2. Change the daemon's stdin loop to deserialize into `BackendCommand` instead of
   ad-hoc string matching — unknown commands become a single typed error path.
3. In the renderer, type `window.tracker.sendCommand` with the generated command type.
4. Derive `TS` for the Rust `Config` struct and export it; if any Electron code still
   reads `~/.dac/config.json` after Phase 3, type it with the generated interface.
5. Create one shared module for Electron↔renderer channel names (e.g.
   `app/ipc-channels.cjs` exporting constants) and use it from `preload.js`, `main.js`
   modules, and via a typed wrapper in the renderer — a renamed channel then fails at
   require-time/compile-time instead of half-landing.
6. **Validate:** `npm run generate:ipc-types`, `tsc --noEmit` in `app/`, dev-run.

---

## Phase 6 — Unify `drodo-core` and Drodo poll orchestration (~half a day)

**Problem (a):** `shared/drodo-core.ts` previously re-exported `shared/drodo-core.mjs` values with
hand-written type assertions — the types are unchecked claims and will drift.

**Steps:**

1. Make TypeScript the single source: port `drodo-core.mjs` to `drodo-core.ts`
   (real implementations, not re-exports).
2. Consumers:
   - `web/` already resolves TS via the workspace import — no change.
   - `ops/cronicle/scripts/poll-drodo.mjs` and `scripts/smoke-drodo-core.mjs` import
     the `.mjs` directly. Either run them with `tsx`/`node --experimental-strip-types`
     (Node ≥ 22.6), or add a tiny build step in `shared/` that emits `drodo-core.mjs`
     from the TS (`tsc` with a second config) and have `package.json` `exports` map
     accordingly. Pick the strip-types route if the ops host's Node version allows —
     zero build step.
3. Delete the re-export shim. Run `npm run test:drodo-core` to confirm the smoke test
   passes against the unified module.

**Problem (b):** Poll orchestration (selecting due users, upserting, snapshots) is
implemented twice — `web/lib/drodo.ts` (behind `/api/cron/poll-drodo`) and
`ops/cronicle/scripts/poll-drodo.mjs`.

**Steps:**

4. Decide which scheduler is live (Cronicle, per `ops/cronicle/README.md`). If yes:
   change `poll-drodo-active.sh` / `poll-drodo-all.sh` to `curl` the
   `/api/cron/poll-drodo` endpoint with `CRON_SECRET` (exactly like
   `.github/workflows/poll-drodo.yml` does), and delete `poll-drodo.mjs`'s
   selection/upsert logic. If the endpoint lacks an `all` mode, add a
   `?mode=all` parameter to the route rather than keeping a second implementation.
5. Document in `ops/cronicle/README.md` which trigger is authoritative and that the
   GitHub workflow is manual-dispatch-only backup.

---

## Phase 7 — Golden-payload tests for finalization heuristics (~1 day, after live-game fixture capture)

**Problem:** One golden-fixture test covers the parser, but the riskiest logic —
`is_match_end_transition`, `finalize_without_end_board`, `detect_personal_elimination`,
capture-owner selection — is untested. These are pure functions (especially after
Phase 4's `match_builder.rs` extraction), so tests are cheap.

**Steps:**

1. When capturing the planned live-game regression fixture, save **both** the raw
   `console.log` (parser input) and the final built match payload + timeline JSON
   (orchestration output).
2. Add a second golden test: parse the fixture log → run the full
   `match_builder` pipeline → compare against the committed payload JSON
   (pretty-printed, stable key order, so diffs are reviewable).
3. Add direct unit tests in `match_builder.rs` for the edge cases the golden fixture
   won't hit: match-end transition with/without `end_board`, elimination of the local
   player mid-game, capture-owner handoff when the owner leaves, empty/partial rows.
4. Wire `cargo test` into CI if not already (extend `.github/workflows/release.yml`
   or add a PR-triggered check workflow) so the goldens actually gate changes.

---

## Deferred / track separately

- **Trust model:** desktop clients write `matches`/`match_players`/`match_timelines`
  directly with the publishable key under RLS, so any client can forge rows.
  Acceptable while dogfooding with friends. Before any wider release, move writes
  behind a Supabase Edge Function that validates the Steam-auth session and
  sanity-checks payloads (roster sizes, round monotonicity, owner = authed user).
  Phase 3 makes this cheap later: only `supabase/` in the Rust crate changes.
- ~~**Import hygiene:** standardize `app/src` on `@dac/shared/...` imports (one stray
  relative import in `app/src/lib/game-utils.ts`; CSS `@import`s of
  `shared/tokens.css`/`components.css` can stay relative).~~ **Done.** `app/src`
  has no relative imports into `shared/` left, and there is no
  `app/src/lib/game-utils.ts` — the module is `shared/game-utils.ts`, whose own
  `./types` import is intra-package and correct.
- **`shared/` layout:** flat is fine at current size; split `ui/` vs `domain/` when it
  next grows past ~25 files.
