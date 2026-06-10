export const DRODO_BASE = "http://autochess.ppbizon.com";
export const DRODO_COURIER_BATCH_SIZE = 200;

export const DRODO_FRESH_TTL_MS = 24 * 60 * 60 * 1000;
export const DRODO_MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EMPTY_DRODO_PROFILE_ERROR =
  "Steam account has no Dota Auto Chess MMR or stats.";

export const POLL_MIN_INTERVAL_SECONDS = 10 * 60;
export const POLL_MAX_INTERVAL_SECONDS = 7 * 24 * 60 * 60;
export const POLL_BACKOFF_FACTOR = 1.5;
export const HOT_POLL_MAX_INTERVAL_SECONDS = 30 * 60;
export const HOT_POLL_BACKOFF_FACTOR = 1.15;

function steamIdValue(steamId) {
  return String(steamId);
}

export function currentSeason(data) {
  let max = 0;
  let season = "";
  for (const key of Object.keys(data)) {
    const match = key.match(/^mmr_s(\d+)$/);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (n > max) {
      max = n;
      season = `s${n}`;
    }
  }
  return season || null;
}

export function extractAllSeasons(steamId, data, currentSeasonKey) {
  const now = new Date().toISOString();
  const seasons = [];
  for (const key of Object.keys(data)) {
    const match = key.match(/^mmr_s(\d+)$/);
    if (!match) continue;
    const n = match[1];
    const seasonKey = `s${n}`;
    seasons.push({
      steam_id: steamIdValue(steamId),
      season: seasonKey,
      mmr: Number(data[`mmr_s${n}`]) || null,
      max_mmr: Number(data[`max_mmr_s${n}`]) || null,
      games_played: Number(data[`match_s${n}`]) || null,
      chicken_count:
        seasonKey === currentSeasonKey ? (Number(data.chicken_count) || null) : null,
      fetched_at: now,
    });
  }
  return seasons.sort((a, b) => Number(a.season.slice(1)) - Number(b.season.slice(1)));
}

export function numberFromDrodoData(data, key) {
  const value = data[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function valueFromDrodoData(data, keys) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function lastWinFromDrodoData(data) {
  return valueFromDrodoData(data, [
    "last_win_at",
    "last_win_date",
    "last_win_time",
    "last_top1_at",
    "last_top1_date",
    "last_top1_time",
    "top1_at",
    "top1_date",
    "top1_time",
    "last_chicken_at",
    "last_chicken_date",
    "last_chicken_time",
  ]);
}

export function lastTop3FromDrodoData(data) {
  return valueFromDrodoData(data, [
    "last_top3_at",
    "last_top3_date",
    "last_top3_time",
    "top3_at",
    "top3_date",
    "top3_time",
  ]);
}

export function buildDrodoProfile(steamId, drodoData) {
  const season = currentSeason(drodoData);
  const mmrKey = season ? `mmr_${season}` : null;
  const maxMmrKey = season ? `max_mmr_${season}` : null;
  const matchKey = season ? `match_${season}` : null;
  const profile = {
    steam_id: steamIdValue(steamId),
    mmr: mmrKey ? Number(drodoData[mmrKey]) || null : null,
    max_mmr: maxMmrKey ? Number(drodoData[maxMmrKey]) || null : null,
    mmr_level: Number(drodoData.mmr_level) || null,
    queen_rank: numberFromDrodoData(drodoData, "queen_rank"),
    last_win_at: lastWinFromDrodoData(drodoData),
    last_top3_at: lastTop3FromDrodoData(drodoData),
    season,
    season_games: matchKey ? Number(drodoData[matchKey]) || null : null,
    candy: Number(drodoData.candy) || null,
    chicken_count: Number(drodoData.chicken_count) || 0,
    raw_data: drodoData,
    fetched_at: new Date().toISOString(),
  };
  return { profile, seasonRows: extractAllSeasons(steamId, drodoData, season) };
}

export function hasDrodoStats(profile, seasonRows) {
  if (
    profile.mmr != null ||
    profile.max_mmr != null ||
    profile.season_games != null ||
    profile.chicken_count > 0
  ) {
    return true;
  }
  return seasonRows.some((row) => row.mmr != null || row.max_mmr != null || row.games_played != null);
}

export function drodoProfileToUserPayload(profile) {
  return {
    steam_id: profile.steam_id,
    drodo_mmr: profile.mmr,
    drodo_max_mmr: profile.max_mmr,
    drodo_mmr_level: profile.mmr_level,
    drodo_season: profile.season,
    drodo_season_games: profile.season_games,
    drodo_candy: profile.candy,
    drodo_chicken_count: profile.chicken_count,
    drodo_raw_data: profile.raw_data,
    drodo_last_fetched_at: profile.fetched_at,
    drodo_profile_missing: false,
  };
}

export function clampInterval(seconds, max = POLL_MAX_INTERVAL_SECONDS) {
  if (!Number.isFinite(seconds) || seconds < POLL_MIN_INTERVAL_SECONDS) {
    return POLL_MIN_INTERVAL_SECONDS;
  }
  if (seconds > max) return max;
  return Math.round(seconds);
}

export function nextPollSchedule({ mode, changed, prevIntervalSeconds, missing = false, hot = false }) {
  const maxInterval = hot ? HOT_POLL_MAX_INTERVAL_SECONDS : POLL_MAX_INTERVAL_SECONDS;
  const backoffFactor = hot ? HOT_POLL_BACKOFF_FACTOR : POLL_BACKOFF_FACTOR;
  let intervalSeconds;
  if (missing) {
    intervalSeconds = maxInterval;
  } else if (mode === "reset" || changed) {
    intervalSeconds = POLL_MIN_INTERVAL_SECONDS;
  } else {
    const prev = prevIntervalSeconds ?? POLL_MIN_INTERVAL_SECONDS;
    intervalSeconds = clampInterval(prev * backoffFactor, maxInterval);
  }
  intervalSeconds = clampInterval(intervalSeconds, maxInterval);
  return {
    next_poll_at: new Date(Date.now() + intervalSeconds * 1000).toISOString(),
    poll_interval_seconds: intervalSeconds,
  };
}

export function pollSnapshotFromRow(row) {
  return {
    drodo_mmr: row.drodo_mmr,
    drodo_season_games: row.drodo_season_games,
    drodo_chicken_count: row.drodo_chicken_count,
    queen_rank: row.drodo_raw_data ? numberFromDrodoData(row.drodo_raw_data, "queen_rank") : null,
    queen_ladder_last_seen_at: row.queen_ladder_last_seen_at,
    poll_interval_seconds: row.poll_interval_seconds,
  };
}

export function isQueenProfile(profile, prev) {
  return (
    profile.queen_rank != null ||
    prev?.queen_rank != null ||
    prev?.queen_ladder_last_seen_at != null
  );
}

export function profileChanged(prev, next) {
  if (!prev) return true;
  return (
    prev.drodo_mmr !== next.mmr ||
    prev.drodo_season_games !== next.season_games ||
    prev.drodo_chicken_count !== next.chicken_count ||
    prev.queen_rank !== next.queen_rank
  );
}
