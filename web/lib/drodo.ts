import type { SupabaseClient } from "@supabase/supabase-js";

const DRODO_BASE = "http://autochess.ppbizon.com";
const DRODO_COURIER_BATCH_SIZE = 200;

/**
 * Cached profiles refresh after 24h on a normal page view; profiles that
 * Drodo returned no data for hold a longer 7-day cooldown so we don't
 * hammer their API for accounts that just don't exist on Auto Chess.
 */
export const DRODO_FRESH_TTL_MS = 24 * 60 * 60 * 1000;
export const DRODO_MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EMPTY_DRODO_PROFILE_ERROR =
  "Steam account has no Dota Auto Chess MMR or stats.";

// Adaptive polling: when the cron tick finds no change we multiply the
// interval, otherwise we reset to the floor. Manual refreshes always
// reset (the user just expressed interest). Missing profiles park at
// the cap until the next manual refresh.
export const POLL_MIN_INTERVAL_SECONDS = 10 * 60; // 10 minutes
export const POLL_MAX_INTERVAL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const POLL_BACKOFF_FACTOR = 1.5;
export const HOT_POLL_MAX_INTERVAL_SECONDS = 30 * 60; // 30 minutes
export const HOT_POLL_BACKOFF_FACTOR = 1.15;

export interface SeasonSnapshotRow {
  steam_id: string;
  season: string;
  mmr: number | null;
  max_mmr: number | null;
  games_played: number | null;
  chicken_count: number | null;
  fetched_at: string;
}

export interface DrodoProfileRow {
  steam_id: string;
  mmr: number | null;
  max_mmr: number | null;
  mmr_level: number | null;
  queen_rank: number | null;
  last_win_at: string | number | null;
  last_top3_at: string | number | null;
  season: string | null;
  season_games: number | null;
  candy: number | null;
  chicken_count: number;
  raw_data: Record<string, unknown>;
  fetched_at: string;
}

export interface CachedUserDrodoRow {
  steam_id: string;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number | null;
  drodo_raw_data: Record<string, unknown> | null;
  drodo_last_fetched_at: string | null;
  drodo_profile_missing: boolean | null;
}

export const USER_DRODO_SELECT = [
  "steam_id::text",
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_mmr_level",
  "drodo_season",
  "drodo_season_games",
  "drodo_candy",
  "drodo_chicken_count",
  "drodo_raw_data",
  "drodo_last_fetched_at",
  "drodo_profile_missing",
].join(", ");

function currentSeason(data: Record<string, unknown>): string | null {
  let max = 0;
  let season = "";
  for (const key of Object.keys(data)) {
    const m = key.match(/^mmr_s(\d+)$/);
    if (m) {
      const n = parseInt(m[1]);
      if (n > max) {
        max = n;
        season = `s${n}`;
      }
    }
  }
  return season || null;
}

function extractAllSeasons(
  steamId: string,
  data: Record<string, unknown>,
  currentSeasonKey: string | null
): SeasonSnapshotRow[] {
  const now = new Date().toISOString();
  const seasons: SeasonSnapshotRow[] = [];
  for (const key of Object.keys(data)) {
    const m = key.match(/^mmr_s(\d+)$/);
    if (m) {
      const n = m[1];
      const seasonKey = `s${n}`;
      seasons.push({
        steam_id: steamId,
        season: seasonKey,
        mmr: Number(data[`mmr_s${n}`]) || null,
        max_mmr: Number(data[`max_mmr_s${n}`]) || null,
        games_played: Number(data[`match_s${n}`]) || null,
        // chicken_count is a running total on Drodo; only valid for the current season.
        chicken_count:
          seasonKey === currentSeasonKey ? (Number(data.chicken_count) || null) : null,
        fetched_at: now,
      });
    }
  }
  return seasons.sort(
    (a, b) => Number(a.season.slice(1)) - Number(b.season.slice(1))
  );
}

function numberFromDrodoData(
  data: Record<string, unknown>,
  key: string
): number | null {
  const value = data[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueFromDrodoData(
  data: Record<string, unknown>,
  keys: string[]
): string | number | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function lastWinFromDrodoData(data: Record<string, unknown>): string | number | null {
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

export function lastTop3FromDrodoData(data: Record<string, unknown>): string | number | null {
  return valueFromDrodoData(data, [
    "last_top3_at",
    "last_top3_date",
    "last_top3_time",
    "top3_at",
    "top3_date",
    "top3_time",
  ]);
}

export function buildDrodoProfile(
  steamId: string,
  drodoData: Record<string, unknown>
): { profile: DrodoProfileRow; seasonRows: SeasonSnapshotRow[] } {
  const season = currentSeason(drodoData);
  const mmrKey = season ? `mmr_${season}` : null;
  const maxMmrKey = season ? `max_mmr_${season}` : null;
  const matchKey = season ? `match_${season}` : null;

  return {
    profile: {
      steam_id: steamId,
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
    },
    seasonRows: extractAllSeasons(steamId, drodoData, season),
  };
}

export function hasDrodoStats(
  profile: Pick<
    DrodoProfileRow,
    "mmr" | "max_mmr" | "season_games" | "chicken_count"
  >,
  seasonRows: Array<
    Pick<SeasonSnapshotRow, "mmr" | "max_mmr" | "games_played">
  >
): boolean {
  if (
    profile.mmr != null ||
    profile.max_mmr != null ||
    profile.season_games != null ||
    profile.chicken_count > 0
  ) {
    return true;
  }
  return seasonRows.some(
    (row) => row.mmr != null || row.max_mmr != null || row.games_played != null
  );
}

export function isFreshCache(
  fetchedAt: string | null | undefined,
  missing: boolean
): boolean {
  if (!fetchedAt) return false;
  const fetchedTime = new Date(fetchedAt).getTime();
  if (!Number.isFinite(fetchedTime)) return false;
  const ttl = missing ? DRODO_MISSING_TTL_MS : DRODO_FRESH_TTL_MS;
  return Date.now() - fetchedTime < ttl;
}

export function cachedUserToDrodoProfile(row: CachedUserDrodoRow): DrodoProfileRow {
  return {
    steam_id: String(row.steam_id),
    mmr: row.drodo_mmr,
    max_mmr: row.drodo_max_mmr,
    mmr_level: row.drodo_mmr_level,
    queen_rank: row.drodo_raw_data
      ? numberFromDrodoData(row.drodo_raw_data, "queen_rank")
      : null,
    last_win_at: row.drodo_raw_data ? lastWinFromDrodoData(row.drodo_raw_data) : null,
    last_top3_at: row.drodo_raw_data ? lastTop3FromDrodoData(row.drodo_raw_data) : null,
    season: row.drodo_season,
    season_games: row.drodo_season_games,
    candy: row.drodo_candy,
    chicken_count: row.drodo_chicken_count ?? 0,
    raw_data: row.drodo_raw_data ?? {},
    fetched_at: row.drodo_last_fetched_at ?? new Date(0).toISOString(),
  };
}

function drodoProfileToUserPayload(
  profile: DrodoProfileRow
): Record<string, unknown> {
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

interface PollSchedule {
  next_poll_at: string;
  poll_interval_seconds: number;
}

interface PollSnapshot {
  drodo_mmr: number | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  queen_rank: number | null;
  queen_ladder_last_seen_at: string | null;
  poll_interval_seconds: number | null;
}

interface PollSnapshotRow extends PollSnapshot {
  steam_id: string;
  drodo_raw_data: Record<string, unknown> | null;
}

function clampInterval(seconds: number, max = POLL_MAX_INTERVAL_SECONDS): number {
  if (!Number.isFinite(seconds) || seconds < POLL_MIN_INTERVAL_SECONDS) {
    return POLL_MIN_INTERVAL_SECONDS;
  }
  if (seconds > max) return max;
  return Math.round(seconds);
}

export function nextPollSchedule(input: {
  mode: "reset" | "adaptive";
  changed: boolean;
  prevIntervalSeconds: number | null;
  missing?: boolean;
  hot?: boolean;
}): PollSchedule {
  const { mode, changed, prevIntervalSeconds, missing = false, hot = false } = input;
  const maxInterval = hot ? HOT_POLL_MAX_INTERVAL_SECONDS : POLL_MAX_INTERVAL_SECONDS;
  const backoffFactor = hot ? HOT_POLL_BACKOFF_FACTOR : POLL_BACKOFF_FACTOR;
  let intervalSeconds: number;

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

async function loadPollSnapshot(
  steamId: string,
  supabase: SupabaseClient
): Promise<PollSnapshot | null> {
  const { data } = await supabase
    .from("users")
    .select(
      "drodo_mmr, drodo_season_games, drodo_chicken_count, drodo_raw_data, queen_ladder_last_seen_at, poll_interval_seconds"
    )
    .eq("steam_id", steamId)
    .maybeSingle<PollSnapshotRow>();
  return data ? pollSnapshotFromRow(data) : null;
}

async function loadPollSnapshots(
  steamIds: string[],
  supabase: SupabaseClient
): Promise<Map<string, PollSnapshot>> {
  if (steamIds.length === 0) return new Map();
  const { data } = await supabase
    .from("users")
    .select(
      "steam_id::text, drodo_mmr, drodo_season_games, drodo_chicken_count, drodo_raw_data, queen_ladder_last_seen_at, poll_interval_seconds"
    )
    .in("steam_id", steamIds);
  return new Map(
    ((data ?? []) as unknown as PollSnapshotRow[]).map((row) => [
      String(row.steam_id),
      pollSnapshotFromRow(row),
    ])
  );
}

function pollSnapshotFromRow(row: PollSnapshotRow): PollSnapshot {
  return {
    drodo_mmr: row.drodo_mmr,
    drodo_season_games: row.drodo_season_games,
    drodo_chicken_count: row.drodo_chicken_count,
    queen_rank: row.drodo_raw_data
      ? numberFromDrodoData(row.drodo_raw_data, "queen_rank")
      : null,
    queen_ladder_last_seen_at: row.queen_ladder_last_seen_at,
    poll_interval_seconds: row.poll_interval_seconds,
  };
}

function isQueenProfile(
  profile: DrodoProfileRow,
  prev: PollSnapshot | null | undefined
): boolean {
  return (
    profile.queen_rank != null ||
    prev?.queen_rank != null ||
    prev?.queen_ladder_last_seen_at != null
  );
}

function profileChanged(
  prev: PollSnapshot | null,
  next: DrodoProfileRow
): boolean {
  if (!prev) return true;
  return (
    prev.drodo_mmr !== next.mmr ||
    prev.drodo_season_games !== next.season_games ||
    prev.drodo_chicken_count !== next.chicken_count ||
    prev.queen_rank !== next.queen_rank
  );
}

export async function markDrodoMissing(
  steamId: string,
  supabase?: SupabaseClient | null
): Promise<string> {
  const fetchedAt = new Date().toISOString();
  if (!supabase) return fetchedAt;
  const schedule = nextPollSchedule({
    mode: "adaptive",
    changed: false,
    prevIntervalSeconds: null,
    missing: true,
  });
  const { error } = await supabase.from("users").upsert(
    {
      steam_id: steamId,
      drodo_mmr: null,
      drodo_max_mmr: null,
      drodo_mmr_level: null,
      drodo_season: null,
      drodo_season_games: null,
      drodo_candy: null,
      drodo_chicken_count: 0,
      drodo_raw_data: null,
      drodo_last_fetched_at: fetchedAt,
      drodo_profile_missing: true,
      next_poll_at: schedule.next_poll_at,
      poll_interval_seconds: schedule.poll_interval_seconds,
    },
    { onConflict: "steam_id" }
  );
  if (error) {
    console.error("Failed to cache missing Drodo profile:", error.message);
  }
  return fetchedAt;
}

export async function purgeDrodoCache(
  steamId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { error: seasonsError } = await supabase
    .from("player_seasons")
    .delete()
    .eq("steam_id", steamId);
  if (seasonsError) {
    console.error(
      "Failed to delete stale player_seasons:",
      seasonsError.message
    );
  }

  const { error: profileError } = await supabase
    .from("users")
    .update({
      drodo_mmr: null,
      drodo_max_mmr: null,
      drodo_mmr_level: null,
      drodo_season: null,
      drodo_season_games: null,
      drodo_candy: null,
      drodo_chicken_count: 0,
      drodo_raw_data: null,
      drodo_last_fetched_at: new Date().toISOString(),
      drodo_profile_missing: true,
    })
    .eq("steam_id", steamId);
  if (profileError) {
    console.error(
      "Failed to delete stale drodo profile:",
      profileError.message
    );
  }
}

export type FetchDrodoResult =
  | {
      ok: true;
      profile: DrodoProfileRow;
      seasonRows: SeasonSnapshotRow[];
    }
  | {
      ok: false;
      kind: "upstream_error" | "missing";
      status?: number;
      error: string;
      fetchedAt?: string;
    };

export type FetchDrodoBatchResult = FetchDrodoResult & { steam_id: string };

async function persistDrodoProfile(
  profile: DrodoProfileRow,
  seasonRows: SeasonSnapshotRow[],
  supabase: SupabaseClient,
  options: {
    snapshotOnSuccess?: boolean;
    pollMode: "adaptive" | "reset";
    hotPoll?: boolean;
    prevSnapshot?: PollSnapshot | null;
  }
): Promise<void> {
  const changed = profileChanged(options.prevSnapshot ?? null, profile);
  const queen = isQueenProfile(profile, options.prevSnapshot);
  const schedule = nextPollSchedule({
    mode: options.pollMode,
    changed,
    prevIntervalSeconds: options.prevSnapshot?.poll_interval_seconds ?? null,
    hot: options.hotPoll || queen,
  });
  const userPayload: Record<string, unknown> = {
    ...drodoProfileToUserPayload(profile),
    next_poll_at: schedule.next_poll_at,
    poll_interval_seconds: schedule.poll_interval_seconds,
  };
  if (queen) {
    userPayload.queen_ladder_last_seen_at = profile.fetched_at;
  }
  const { error: upsertError } = await supabase
    .from("users")
    .upsert(userPayload, { onConflict: "steam_id" });
  if (upsertError) {
    console.error("Failed to cache Drodo profile:", upsertError.message);
  }

  if (options.snapshotOnSuccess) {
    const { error: snapshotError } = await supabase
      .from("mmr_snapshots")
      .upsert(
        {
          steam_id: profile.steam_id,
          mmr: profile.mmr,
          season: profile.season,
          chicken_count: profile.chicken_count,
          queen_rank: profile.queen_rank,
          snapshotted_at: new Date().toISOString(),
        },
        { onConflict: "steam_id,season,mmr,chicken_count,queen_rank" }
      );
    if (snapshotError) {
      console.error("Failed to upsert mmr_snapshot:", snapshotError.message);
    }
  }

  if (seasonRows.length > 0) {
    const { data: existingSeasons } = await supabase
      .from("player_seasons")
      .select("season, chicken_count")
      .eq("steam_id", profile.steam_id);
    const existingChickenCounts = new Map(
      (existingSeasons ?? []).map((r) => [
        r.season,
        r.chicken_count as number | null,
      ])
    );
    const mergedRows = seasonRows.map((row) => ({
      ...row,
      chicken_count:
        row.chicken_count ?? existingChickenCounts.get(row.season) ?? null,
    }));
    const { error: seasonsError } = await supabase
      .from("player_seasons")
      .upsert(mergedRows, { onConflict: "steam_id,season" });
    if (seasonsError) {
      console.error(
        "Failed to upsert player_seasons:",
        seasonsError.message
      );
    }
  }
}

export async function fetchAndCacheDrodoBatch(
  steamIds: string[],
  supabase: SupabaseClient,
  options: {
    snapshotOnSuccess?: boolean;
    pollMode?: "adaptive" | "reset";
    hotPoll?: boolean;
  } = {}
): Promise<FetchDrodoBatchResult[]> {
  const ids = [...new Set(steamIds.map(String).filter(Boolean))];
  if (ids.length === 0) return [];

  if (ids.length > DRODO_COURIER_BATCH_SIZE) {
    const results: FetchDrodoBatchResult[] = [];
    for (let i = 0; i < ids.length; i += DRODO_COURIER_BATCH_SIZE) {
      results.push(
        ...(await fetchAndCacheDrodoBatch(
          ids.slice(i, i + DRODO_COURIER_BATCH_SIZE),
          supabase,
          options
        ))
      );
    }
    return results;
  }

  const pollMode = options.pollMode ?? "reset";
  const prevSnapshots =
    pollMode === "adaptive" ? await loadPollSnapshots(ids, supabase) : new Map();

  let payload: unknown;
  try {
    const resp = await fetch(`${DRODO_BASE}/courier/get/@${ids.join(",")}`);
    if (!resp.ok) {
      return ids.map((steamId) => ({
        steam_id: steamId,
        ok: false,
        kind: "upstream_error",
        status: resp.status,
        error: "Drodo API error",
      }));
    }
    payload = await resp.json();
  } catch {
    return ids.map((steamId) => ({
      steam_id: steamId,
      ok: false,
      kind: "upstream_error",
      error: "Failed to reach Drodo API",
    }));
  }

  const json = payload as {
    err?: number;
    user_info?: Record<string, Record<string, unknown>>;
  };
  const results: FetchDrodoBatchResult[] = [];
  for (const steamId of ids) {
    const drodoData = json.user_info?.[steamId];
    if (json.err !== 0 || !drodoData) {
      const fetchedAt = await markDrodoMissing(steamId, supabase);
      results.push({
        steam_id: steamId,
        ok: false,
        kind: "missing",
        error: "Player not found on Drodo",
        fetchedAt,
      });
      continue;
    }

    const { profile, seasonRows } = buildDrodoProfile(steamId, drodoData);
    if (!hasDrodoStats(profile, seasonRows)) {
      const fetchedAt = await markDrodoMissing(steamId, supabase);
      results.push({
        steam_id: steamId,
        ok: false,
        kind: "missing",
        error: EMPTY_DRODO_PROFILE_ERROR,
        fetchedAt,
      });
      continue;
    }

    await persistDrodoProfile(profile, seasonRows, supabase, {
      snapshotOnSuccess: options.snapshotOnSuccess,
      pollMode,
      hotPoll: options.hotPoll,
      prevSnapshot: prevSnapshots.get(steamId) ?? null,
    });
    results.push({ steam_id: steamId, ok: true, profile, seasonRows });
  }

  return results;
}

/**
 * Hit Drodo, persist the result, and snapshot when requested.
 *
 * On a missing/empty Drodo profile, marks the cached row missing so
 * isFreshCache(..., true) keeps us off Drodo's API for the missing TTL.
 * Caller is responsible for cooldown — this always fetches when called.
 */
export async function fetchAndCacheDrodo(
  steamId: string,
  supabase: SupabaseClient | null,
  options: {
    snapshotOnSuccess?: boolean;
    /** "adaptive" backs off when nothing changed; "reset" always returns to the floor (manual refresh, first-pull). */
    pollMode?: "adaptive" | "reset";
    /** Keep Queen/active players near the 10-minute floor instead of drifting onto the general background schedule. */
    hotPoll?: boolean;
  } = {}
): Promise<FetchDrodoResult> {
  const pollMode = options.pollMode ?? "reset";
  const prevSnapshot =
    supabase && pollMode === "adaptive"
      ? await loadPollSnapshot(steamId, supabase)
      : null;
  let drodoData: Record<string, unknown>;
  try {
    const resp = await fetch(`${DRODO_BASE}/courier/get/@${steamId}`);
    if (!resp.ok) {
      return {
        ok: false,
        kind: "upstream_error",
        status: resp.status,
        error: "Drodo API error",
      };
    }
    const json = await resp.json();
    if (json.err !== 0 || !json.user_info?.[steamId]) {
      const fetchedAt = await markDrodoMissing(steamId, supabase);
      return {
        ok: false,
        kind: "missing",
        error: "Player not found on Drodo",
        fetchedAt,
      };
    }
    drodoData = json.user_info[steamId];
  } catch {
    return {
      ok: false,
      kind: "upstream_error",
      error: "Failed to reach Drodo API",
    };
  }

  const { profile, seasonRows } = buildDrodoProfile(steamId, drodoData);

  if (!hasDrodoStats(profile, seasonRows)) {
    const fetchedAt = await markDrodoMissing(steamId, supabase);
    return {
      ok: false,
      kind: "missing",
      error: EMPTY_DRODO_PROFILE_ERROR,
      fetchedAt,
    };
  }

  if (!supabase) {
    return { ok: true, profile, seasonRows };
  }

  await persistDrodoProfile(profile, seasonRows, supabase, {
    snapshotOnSuccess: options.snapshotOnSuccess,
    pollMode,
    hotPoll: options.hotPoll,
    prevSnapshot,
  });

  return { ok: true, profile, seasonRows };
}
