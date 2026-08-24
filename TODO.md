# TODO

Parked and unfinished work. Plan each item separately before implementing.

## Product (admin-gated, not public yet)

- [ ] **Builds** — Community planner, share links, submit/review, votes, and comments already exist. `/builds` and `/builds/[id]` are behind PostHog `admin_access` (`AdminGate` + `requireAdmin` on every API, including GET of approved builds). Nav hides Builds unless you are admin. Pages are `noindex`. `/builds/review` stays admin-only.

- [ ] **Chatbot** — Admin-gated streaming widget via Vercel AI Gateway (`alibaba/qwen3.7-flash`). Synergy questions are grounded in committed content (plus that synergy's units). Unit/item lookup, guides, and embeddings are later. Access is the existing `admin_access` check.

- [ ] **Guides** — `/guides` is also admin-gated (same `admin_access` flag). Not a public launch yet.

- [ ] **Guide Core Units table** — Replace markdown table-as-essay with scannable rows (unit icon + name, cost, synergy chips, short priority/role tag); move long explanations to prose below the table.

- [ ] **Guide typography** — Fix heading hierarchy so h2/h3 clearly outrank body text (current h2 at ~1.25rem reads flat against 16px body).

## Capture / desktop

- [ ] **Architecture Phase 7** — Golden-payload tests for match finalization heuristics. Needs a live-game fixture. The only open item in `docs/architecture-remediation-plan.md`.

- [ ] **Live-capture followups** (`docs/live-capture-followups.md`):
  - [ ] Structured chess board timeline in `match_timelines` (positions/items from `vchess_*`)
  - [ ] Diagnostic log rotation/retention after a successful upload
  - [ ] Desktop home/history consolidation

- [ ] **Focus-free capture** — Research only. Official surfaces (`-condebug`, GSI, `autoexec.cfg` binds) still require Dota to be focused. A workshop-VPK Panorama inject was sketched and is not product direction. See the dota2-minify / nettable storage chat.

## Data / Drodo

- [ ] **Drodo MMR** — `DRODO_MMR_ENABLED` is `false`. Numeric MMR stays hidden until Drodo returns season fields.

- [ ] **Queens Drodo refresh** — `QUEENS_DRODO_VIEW_REFRESH_ENABLED` is `false`. `/queens` shows last in-game ladder capture. The GitHub cron and `/api/cron/queens-refresh` were removed. Re-enable when Drodo season MMR is back (flag + a new scheduled caller).

## Repo hygiene

- [ ] **GitHub issue #290** — Fill with roadmap context. Cloud agents cannot read or write Issues (403). Closed docs PR: [#292](https://github.com/jackthb/dac-tools/pull/292).

- [ ] **Known `cargo test` failure** — `nettable_service::tests::parity_events_emit_round_creep_and_personal_elimination` (asserts `session_dumps.len() == 1`). Fails on a clean checkout.
