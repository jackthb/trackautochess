# Follow-up: gate the active Drodo poll on real user activity

**Status:** not started — captured for a future iteration.

## What we want

The background Drodo poller should only keep a user "hot" if they are actually
active: **signed in via Steam recently OR accessed the site recently.** We should
*not* keep polling a user forever just because they appear on the Queen ladder.

Today the active cohort filter includes `queen_ladder_rank.not.is.null`, which
unconditionally keeps every Queen-ladder player in the hourly hot poll even if
they signed in months ago and never visit. We want to drop that "queen forever"
behaviour in favour of an activity gate.

## Why it isn't a one-line change

### 1. There is no "accessed the site recently" signal stored

The `users` table only has these activity-ish timestamps:

- `steam_signed_in_at` — written **only** on an actual Steam sign-in
  (`web/lib/steam.ts`), not on a plain page view.
- `queen_ladder_last_seen_at` — last seen on the Queen ladder.
- `drodo_last_fetched_at` — when we last polled their Drodo profile.

Nothing records "this user opened a profile / the queens page." The only proxy
is indirect: viewing a profile (`web/app/api/drodo/[steamId]/route.ts`) refreshes
it and the adaptive scheduler rewrites `next_poll_at` / `poll_interval_seconds` —
and even that only sets a short ("hot") interval for **queen** profiles, not
regular ones.

### 2. The active-cohort filter is duplicated in four places

Any change must be applied to all of them or they silently desync:

| File | Notes |
|------|-------|
| `ops/cronicle/scripts/poll-drodo.mjs` | `activeSyncFilter()` — adds `poll_interval_seconds.lte.HOT_POLL_MAX_INTERVAL_SECONDS` |
| `web/scripts/poll-drodo.mts` | `steam_signed_in_at.gte.X, queen_ladder_rank.not.is.null` |
| `web/app/api/cron/poll-drodo/route.ts` | same family |
| `web/app/api/admin/usage/route.ts` | drives the usage dashboard's "active" count |

Ideally the filter is defined once (e.g. in `shared/drodo-core`) and imported by
all four, so it can never drift again.

## Options for "accessed the site recently"

1. **Add a `users.last_viewed_at` column** (preferred for accuracy). Write it
   whenever `/api/drodo/[steamId]` or the `/queens` page serves a user. Active
   filter becomes: signed-in recently **OR** `last_viewed_at` recent. Requires a
   migration + write path + regenerated types.
2. **Rely on the adaptive cadence (no new column).** Drop the queen term; keep
   `steam_signed_in_at` + `poll_interval_seconds <= HOT`. Page views already feed
   the adaptive scheduler, so recently-viewed users stay in while their interval
   is short. Simpler, but a viewed *non-queen* only stays hot as long as its
   interval is short, and regular views don't currently set a hot interval.
3. **Just drop the queen term.** Active filter = `steam_signed_in_at` recent only.
   Dormant queens stop being background-polled; freshness for viewed players comes
   purely from the on-demand refresh on the page view itself.

## Decision needed before implementing

Pick one of the three options above (whether to add a real `last_viewed_at`
column or lean on the adaptive-cadence proxy), then apply the chosen filter
consistently across all four files and update `ops/cronicle/README.md`.

## Watch out for

- This reverses part of the deliberately-merged design (queens kept hot so the
  public `/queens` ladder stays fresh during hours nobody is viewing). Confirm the
  on-demand `/queens` refresh path adequately covers ladder freshness before
  relying on it.
- Keep the usage dashboard's "active" definition in sync with the poller's, or
  the dashboard's active count will stop matching what actually gets polled.
