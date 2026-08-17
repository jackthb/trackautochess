# TODO

Parked and unfinished work. Plan each item separately before implementing.

## Product (admin-gated, not public yet)

- [ ] **Builds** — Community planner, share links, submit/review, votes, and comments already exist. `/builds` and `/builds/[id]` are behind PostHog `admin_access` (`AdminGate` + `requireAdmin` on every API, including GET of approved builds). Nav hides Builds unless you are admin. Pages are `noindex`. `/builds/review` stays admin-only.

- [ ] **Chatbot** — Signed-in RAG widget over units, synergies, items, relics, talents, and patch notes. Vercel AI Gateway (`google/gemini-2.5-flash` + `text-embedding-3-small`), streaming UI, sources with links, 10 req/min, 2000/day global cap. The code already says to split off a dedicated flag. Embeddings refresh is a manual `pnpm --dir web run embed-content`.

- [ ] **Guides** — `/guides` is also admin-gated (same `admin_access` flag). Not a public launch yet.

## Capture / desktop

- [ ] **Architecture Phase 7** — Golden-payload tests for match finalization heuristics. Needs a live-game fixture. The only open item in `docs/architecture-remediation-plan.md`.

- [ ] **Live-capture followups** (`docs/live-capture-followups.md`):
  - [ ] Structured chess board timeline in `match_timelines` (positions/items from `vchess_*`)
  - [ ] Diagnostic log rotation/retention after a successful upload
  - [ ] Desktop home/history consolidation

- [ ] **Focus-free capture** — Research only. Official surfaces (`-condebug`, GSI, `autoexec.cfg` binds) still require Dota to be focused. A workshop-VPK Panorama inject was sketched and is not product direction. See the dota2-minify / nettable storage chat.

## Data / Drodo

- [ ] **Drodo MMR** — `DRODO_MMR_ENABLED` is `false`. Numeric MMR stays hidden until Drodo returns season fields.

- [ ] **Queens Drodo refresh** — `QUEENS_DRODO_VIEW_REFRESH_ENABLED` is `false`. `/queens` shows last in-game ladder capture. Cron route no-ops; `refresh-queens.yml` was deleted. Re-enable when Drodo season MMR is back.

## Repo hygiene

- [ ] **GitHub issue #290** — Fill with roadmap context. Cloud agents cannot read or write Issues (403). Closed docs PR: [#292](https://github.com/jackthb/dac-tools/pull/292).

- [ ] **Known `cargo test` failure** — `nettable_service::tests::parity_events_emit_round_creep_and_personal_elimination` (asserts `session_dumps.len() == 1`). Fails on a clean checkout.
