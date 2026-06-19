# Drodo Polling Policy

This document is the target policy for background Drodo polling. It covers
scheduled polling only. Manual/profile-page refresh behaviour is separate and
should not be used as part of the background polling cadence.

## Goals

- Keep the public Queen board fresh without polling every tracked user.
- Keep active and inactive tracked players on a predictable daily cadence.
- Define polling cohorts once so web routes, Cronicle jobs, admin dashboards,
  and documentation cannot drift.

## Cadence

| Cohort | Cadence | Notes |
| --- | --- | --- |
| Visible Queen board | Every 5 minutes | Refresh the rows shown on `/queens`, currently the displayed top 100 after ranking, dedupe, and tie-break rules. |
| Active players | Once per day | A player is active when they have recently signed in with Steam or currently have a Queen ladder rank. |
| Inactive players | Once per day | Covers tracked users who are not active players. |

## Cohort Definitions

### Visible Queen Board

The visible Queen board cohort is the set of users that actually appear on the
public `/queens` table after applying the page's display logic.

This is intentionally not the same as "every known Queen player." The visible
board refresh is a separate five-minute path for the public table. Known Queen
players also count as active for the daily background poll.

### Active Players

An active player is a user with a recent `steam_signed_in_at` value or a current
`queen_ladder_rank`. The exact sign-in window should live in shared code and be
imported everywhere the polling cohort is computed.

Queen status counts as active because a player can push into the Queen ranking
between visible-board refreshes. The visible Queen board refresh covers the
public table, while the daily active poll keeps known Queen profiles moving even
when they are not currently on the displayed page.

### Inactive Players

An inactive player is any tracked user with a cached non-missing Drodo profile
who is not currently in the active cohort.

Inactive polling should be oldest-first by `drodo_last_fetched_at` and should
only select rows that are at least one daily interval old.

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
