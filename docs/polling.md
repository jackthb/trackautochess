# Drodo Polling Policy

This document is the target policy for background Drodo polling. It covers
scheduled polling only. Manual/profile-page refresh behaviour is separate and
should not be used as part of the background polling cadence.

## Goals

- Keep the public Queen board on the saved in-game ladder capture (not Drodo).
- Keep recently signed-in players on a predictable daily cadence.
- Poll everyone else weekly — Drodo no longer returns useful Queen ladder fields.
- Define polling cohorts once so web routes, Cronicle jobs, admin dashboards,
  and documentation cannot drift.

## Cadence

| Cohort | Cadence | Notes |
| --- | --- | --- |
| All Drodo live fetch | **Parked** | Public `/courier/get` no longer returns season MMR. Flip `DRODO_LIVE_FETCH_ENABLED` in `web/lib/drodoLive.ts` (and Cronicle `DRODO_LIVE_FETCH_ENABLED=1`) only if Drodo restores those fields. |
| Visible Queen board | Capture-driven (Drodo refresh parked) | `/queens` shows the saved in-game ladder snapshot. The 5-minute Drodo view refresh is behind `QUEENS_DRODO_VIEW_REFRESH_ENABLED`. |
| Active players | Once per day | Parked while live fetch is off. |
| Inactive players | Once per week | Parked while live fetch is off. |

## Season MMR omission

Drodo's public `/courier/get` payload currently omits `mmr_s*`, `max_mmr_s*`,
`match_s*`, and `queen_rank` for most accounts while still returning
`mmr_level` / `chicken_count` / cosmetics. Live polling and profile refresh are
disabled site-wide; profiles show rank from `mmr_level` only.

## Cohort Definitions

### Visible Queen Board

The visible Queen board cohort is the set of users that actually appear on the
public `/queens` table after applying the page's display logic.

Board freshness comes from desktop ladder capture uploads. The parked Drodo
view-refresh path can be re-enabled later if Drodo starts returning ranks again.

### Active Players

An active player is a user with a recent `steam_signed_in_at` value. The exact
sign-in window lives in shared code (`ACTIVE_SIGN_IN_WINDOW_MS` / helpers in
`shared/drodo-core.ts`) and is imported everywhere the polling cohort is computed.

Queen ladder membership alone does not keep a user in the active cohort.

### Inactive Players

An inactive player is any tracked user with a cached non-missing Drodo profile
who is not currently in the active cohort.

Inactive polling should be oldest-first by `drodo_last_fetched_at` and should
only select rows that are at least one inactive interval old (7 days).

## Out of Scope

Manual and request-driven refreshes are separate:

- Profile page cache freshness.
- Explicit user-triggered refreshes.
- Any logged-in user experience that forces a one-off refresh.

Those paths may update the same Drodo fields and snapshots, but they should not
define the background polling policy.

## Implementation Alignment

Keep the policy in shared code when changing cadence in production:

- Shared constants for Queen board, active, and inactive intervals.
- Shared active-cohort helper or query builder.
- Shared inactive eligibility helper or query builder.
- Shared tests for cohort classification.

Known places wired to, or expected to stay aligned with, the shared policy:

- `shared/drodo-core.ts` (source)
- `shared/drodo-core.mjs` / `shared/drodo-core.d.mts` (generated runtime/types)
- `ops/cronicle/scripts/poll-drodo.mjs`
- `ops/cronicle/cronicle-job.dac-poll-drodo-active.json` (disabled while parked)
- `ops/cronicle/cronicle-job.dac-poll-drodo-all.json` (disabled while parked)
- `ops/cronicle/README.md`
- `web/lib/queensRefresh.ts`
- `web/lib/queensVisitor.ts`
- Any admin/usage view that reports active polling counts.

The intended final shape is one source of truth for policy plus thin adapters
for Supabase JS, Supabase REST, and operational docs.
