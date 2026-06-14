import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRODO_FRESH_TTL_MS,
  DRODO_MISSING_TTL_MS,
  EMPTY_DRODO_PROFILE_ERROR,
  HOT_POLL_MAX_INTERVAL_SECONDS,
  buildDrodoProfile,
  drodoProfileToUserPayload,
  fetchDrodoProfileBatch,
  hasDrodoStats,
  isQueenProfile,
  lastTop3FromDrodoData,
  lastWinFromDrodoData,
  nextPollSchedule,
  pollSnapshotFromRow,
  profileChanged,
  summarizeDrodoResults,
  type DrodoProfileRow,
  type FetchDrodoBatchResult,
  type FetchDrodoResult,
  type PollSnapshot,
  type PollSnapshotRow,
  type SeasonSnapshotRow,
} from "@dac/shared/drodo-core";

/**
 * Cached profiles refresh after 24h on a normal page view; profiles that
 * Drodo returned no data for hold a longer 7-day cooldown so we don't
 * hammer their API for accounts that just don't exist on Auto Chess.
 */
export {
  DRODO_FRESH_TTL_MS,
  DRODO_MISSING_TTL_MS,
  EMPTY_DRODO_PROFILE_ERROR,
  HOT_POLL_MAX_INTERVAL_SECONDS,
};

export const HOT_PROFILE_REFRESH_TTL_SECONDS = HOT_POLL_MAX_INTERVAL_SECONDS;
export {
  buildDrodoProfile,
  drodoProfileToUserPayload,
  hasDrodoStats,
  lastTop3FromDrodoData,
  lastWinFromDrodoData,
  nextPollSchedule,
  summarizeDrodoResults,
};
export type { DrodoProfileRow, SeasonSnapshotRow };

// Drodo's upstream (autochess.ppbizon.com) is intermittently slow/unreachable.
// Without a timeout a stalled connection holds the serverless invocation until
// it dies as `fetch failed`; cap it so the batch returns an upstream_error
// cleanly instead. Mirrors the 10s cap on the Rust backend's poller.
const DRODO_FETCH_TIMEOUT_MS = 10_000;

const drodoFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(DRODO_FETCH_TIMEOUT_MS) });

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
  queen_ladder_rank: number | null;
  queen_ladder_last_seen_at: string | null;
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
  "queen_ladder_rank",
  "queen_ladder_last_seen_at",
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
    queen_rank: row.queen_ladder_rank,
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
      "drodo_mmr, drodo_season_games, drodo_chicken_count, queen_ladder_rank, queen_ladder_last_seen_at, poll_interval_seconds"
    )
    .filter("steam_id", "eq", steamId)
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
      "steam_id::text, drodo_mmr, drodo_season_games, drodo_chicken_count, queen_ladder_rank, queen_ladder_last_seen_at, poll_interval_seconds"
    )
    .filter("steam_id", "in", `(${steamIds.join(",")})`);
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
    .filter("steam_id", "eq", steamId);
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
    .filter("steam_id", "eq", steamId);
  if (profileError) {
    console.error(
      "Failed to delete stale drodo profile:",
      profileError.message
    );
  }
}

export type { FetchDrodoBatchResult, FetchDrodoResult };

async function persistDrodoProfile(
  profile: DrodoProfileRow,
  seasonRows: SeasonSnapshotRow[],
  supabase: SupabaseClient,
  options: {
    snapshotOnSuccess?: boolean;
    pollMode: "adaptive" | "reset";
    hotPoll?: boolean;
    prevSnapshot?: PollSnapshot | null;
    onQueenChange?: (profile: DrodoProfileRow) => void;
  }
): Promise<void> {
  const changed = profileChanged(options.prevSnapshot ?? null, profile);
  const queen = isQueenProfile(profile, options.prevSnapshot);
  const schedule = nextPollSchedule({
    mode: options.pollMode,
    changed,
    prevIntervalSeconds: options.prevSnapshot?.poll_interval_seconds ?? null,
    hot: options.hotPoll || queen,
    fixedHot: queen,
  });
  const userPayload: Record<string, unknown> = {
    ...drodoProfileToUserPayload(profile),
    next_poll_at: schedule.next_poll_at,
    poll_interval_seconds: schedule.poll_interval_seconds,
  };
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
          queen_rank: null,
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
      .filter("steam_id", "eq", profile.steam_id);
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

  // Queen rows feed the ISR'd /queens table; notify the caller the moment a
  // ladder player's stats move so it can rebuild the page instead of waiting
  // out the revalidate window. A callback (rather than revalidatePath here)
  // keeps server-only next/cache out of this module — client components and
  // the standalone poll script import it too.
  if (options.onQueenChange && queen && changed) {
    try {
      options.onQueenChange(profile);
    } catch (error) {
      console.error("Queen change notification failed:", error);
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
    /** Called when a persisted Queen profile's stats changed (e.g. to rebuild /queens). */
    onQueenChange?: (profile: DrodoProfileRow) => void;
  } = {}
): Promise<FetchDrodoBatchResult[]> {
  return fetchDrodoProfileBatch(
    steamIds,
    {
      fetch: drodoFetch,
      loadPollSnapshots: (ids) => loadPollSnapshots(ids, supabase),
      markMissing: (steamId) => markDrodoMissing(steamId, supabase),
      persistProfile: (profile, seasonRows, persistOptions) =>
        persistDrodoProfile(profile, seasonRows, supabase, {
          ...persistOptions,
          onQueenChange: options.onQueenChange,
        }),
    },
    options
  );
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
    /** Keep hot profiles capped to the short background cadence. Queens may opt into a fixed cadence when persisted. */
    hotPoll?: boolean;
    /** Called when a persisted Queen profile's stats changed (e.g. to rebuild /queens). */
    onQueenChange?: (profile: DrodoProfileRow) => void;
  } = {}
): Promise<FetchDrodoResult> {
  const result = await fetchDrodoProfileBatch(
    [steamId],
    {
      fetch: drodoFetch,
      loadPollSnapshots: async (ids) => {
        if (!supabase || options.pollMode !== "adaptive") return new Map();
        const snapshot = await loadPollSnapshot(ids[0], supabase);
        return snapshot ? new Map([[ids[0], snapshot]]) : new Map();
      },
      markMissing: (id) => markDrodoMissing(id, supabase),
      persistProfile: async (profile, seasonRows, persistOptions) => {
        if (!supabase) return;
        await persistDrodoProfile(profile, seasonRows, supabase, {
          ...persistOptions,
          onQueenChange: options.onQueenChange,
        });
      },
    },
    options
  );
  return result[0] ?? {
    ok: false,
    kind: "upstream_error",
    error: "Failed to reach Drodo API",
  };
}
