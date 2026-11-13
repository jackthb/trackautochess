/**
 * Drodo's public `/courier/get` returns season MMR and `queen_rank` again
 * (flat `user_info`, one Steam ID per call). Verified live on 2026-10-24.
 * `DRODO_MMR_ENABLED` and `DRODO_BACKGROUND_POLL_ENABLED` live in
 * `shared/drodo-core` so the web UI and the Cronicle poller share one switch.
 */
export {
  DRODO_BACKGROUND_POLL_ENABLED,
  DRODO_MMR_ENABLED,
} from "@dac/shared/drodo-core";

/** Page views and manual refreshes call Drodo. */
export const DRODO_LIVE_FETCH_ENABLED = true;

export const DRODO_OUTAGE_NOTICE =
  "Drodo stopped publishing MMR stats, so we can't show MMR anymore. Ranks are still live.";
