/**
 * Drodo's public `/courier/get` no longer returns numeric season MMR
 * (`mmr_s*`, `max_mmr_s*`, `match_s*`), but it does still return `mmr_level` —
 * the rank ladder position — and the in-game Queen ladder still supplies queen
 * rank. So the live fetch runs in rank-only mode: profiles refresh on page
 * hits and keep their rank current, while every MMR number stays hidden.
 */
export const DRODO_LIVE_FETCH_ENABLED = true;

/** Numeric MMR is not published any more; never render or seed it. */
export const DRODO_MMR_ENABLED = false;

/** Scheduled background polling stays parked: rank refreshes ride on page
 *  hits and manual refreshes, so the cron job would only add upstream load. */
export const DRODO_BACKGROUND_POLL_ENABLED = false;

export const DRODO_OUTAGE_NOTICE =
  "Drodo stopped publishing MMR stats, so we can't show MMR anymore. Ranks are still live.";
