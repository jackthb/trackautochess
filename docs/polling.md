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
| Visible Queen board | Capture-driven (Drodo refresh parked) | `/queens` shows the saved in-game ladder snapshot. The 5-minute Drodo view refresh is behind `QUEENS_DRODO_VIEW_REFRESH_ENABLED` until Drodo returns `queen_rank` / season MMR again. |
| Active players | Once per day | Recently signed in with Steam (14-day window). Queen ladder rank does **not** count as active. |
| Inactive players | Once per week | Tracked users who are not in the active cohort. |

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
- `ops/cronicle/cronicle-job.dac-poll-drodo-active.json`
- `ops/cronicle/cronicle-job.dac-poll-drodo-all.json`
- `ops/cronicle/README.md`
- `web/app/api/cron/poll-drodo/route.ts`
- `web/app/api/cron/queens-refresh/route.ts`
- `web/lib/queensRefresh.ts`
- `web/lib/queensVisitor.ts`
- Any admin/usage view that reports active polling counts.

The intended final shape is one source of truth for policy plus thin adapters
for Supabase JS, Supabase REST, and operational docs.
