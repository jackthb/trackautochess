export {
  QUEENS_REFRESH_COOLDOWN_MS,
  QUEENS_VIEW_REFRESH_COOLDOWN_MS,
} from "@dac/shared/drodo-core";

/**
 * When false, `/queens` renders the saved in-game ladder capture and skips
 * Drodo-driven view refresh. Keep `/api/queens/refresh` and the client wired
 * so we can flip this back on if Drodo starts returning `queen_rank` / season
 * MMR again.
 */
export const QUEENS_DRODO_VIEW_REFRESH_ENABLED = false;
