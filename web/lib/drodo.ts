import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRODO_BASE,
  DRODO_COURIER_BATCH_SIZE,
  DRODO_FRESH_TTL_MS,
  DRODO_MISSING_TTL_MS,
  EMPTY_DRODO_PROFILE_ERROR,
  buildDrodoProfile,
  drodoProfileToUserPayload,
  hasDrodoStats,
  isQueenProfile,
  lastTop3FromDrodoData,
  lastWinFromDrodoData,
  nextPollSchedule,
  numberFromDrodoData,
  pollSnapshotFromRow,
  profileChanged,
  type DrodoProfileRow,
  type PollSnapshot,
  type PollSnapshotRow,
  type SeasonSnapshotRow,
} from "@dac/shared/drodo-core";

/**
 * Cached profiles refresh after 24h on a normal page view; profiles that
 * Drodo returned no data for hold a longer 7-day cooldown so we don't
 * hammer their API for accounts that just don't exist on Auto Chess.
 */
export { DRODO_FRESH_TTL_MS, DRODO_MISSING_TTL_MS, EMPTY_DRODO_PROFILE_ERROR };
export {
  buildDrodoProfile,
  drodoProfileToUserPayload,
  hasDrodoStats,
  lastTop3FromDrodoData,
  lastWinFromDrodoData,
  nextPollSchedule,
};
export type { DrodoProfileRow, SeasonSnapshotRow };

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
