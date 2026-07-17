/**
 * Drodo's public `/courier/get` no longer returns numeric season MMR
 * (`mmr_s*`, `max_mmr_s*`, `match_s*`) or reliable `queen_rank`. Until that
 * comes back (or the desktop tracker ships), do not call Drodo for live stats.
 */
export const DRODO_LIVE_FETCH_ENABLED = false;

export const DRODO_OUTAGE_NOTICE =
  "Live MMR isn't available anymore — Drodo stopped publishing it. We can only show rank. Sorry.";
