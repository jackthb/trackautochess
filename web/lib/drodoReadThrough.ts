import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cachedUserToDrodoProfile,
  EMPTY_DRODO_PROFILE_ERROR,
  fetchAndCacheDrodo,
  hasDrodoStats,
  isFreshCache,
  purgeDrodoCache,
  USER_DRODO_SELECT,
  type CachedUserDrodoRow,
  type DrodoProfileRow,
  type FetchDrodoResult,
  type SeasonSnapshotRow,
} from "@/lib/drodo";

export interface DrodoHistory {
  seasons: SeasonSnapshotRow[];
  mmr_history: Array<{ mmr: number | null; snapshotted_at: string }>;
  queen_rank_history: Array<{ queen_rank: number; snapshotted_at: string }>;
}

export type DrodoProfilePayload = DrodoProfileRow &
  DrodoHistory & {
    refresh_pending?: boolean;
  };

export type ReadThroughDrodoProfileResult =
  | {
      kind: "profile";
      source: "cache" | "drodo" | "stale";
      payload: DrodoProfilePayload;
    }
  | {
      kind: "missing";
      source: "cache" | "drodo";
      error: string;
      fetched_at: string;
    }
  | {
      kind: "upstream_error";
      error: string;
      status?: number;
      stale?: DrodoProfilePayload;
    }
  | {
      kind: "refresh_in_progress";
      stale?: DrodoProfilePayload;
    };

export interface ReadThroughDrodoProfileOptions {
  steamId: string;
  supabase: SupabaseClient | null;
  forceRefresh?: boolean;
  snapshotOnSuccess?: boolean;
  pollMode?: "adaptive" | "reset";
  hotPoll?: boolean;
  cachedRow?: CachedUserDrodoRow | null;
  onQueenChange?: (profile: DrodoProfileRow) => void;
}

const PROFILE_REFRESH_LOCK_TTL_MS = 60_000;

export function isCachedQueenProfile(row: CachedUserDrodoRow | null): boolean {
  if (!row) return false;
  return Boolean(
    row.queen_ladder_last_seen_at ||
      cachedUserToDrodoProfile(row).queen_rank != null
  );
}

export async function loadCachedDrodoRow(
  supabase: SupabaseClient,
  steamId: string
): Promise<CachedUserDrodoRow | null> {
  const { data } = await supabase
    .from("users")
    .select(USER_DRODO_SELECT)
    .filter("steam_id", "eq", steamId)
    .maybeSingle<CachedUserDrodoRow>();
  return data ?? null;
}

export async function loadDrodoHistory(
  supabase: SupabaseClient,
  steamId: string
): Promise<DrodoHistory> {
  const [seasonsResult, snapshotsResult] = await Promise.all([
    supabase
      .from("player_seasons")
      .select("season, mmr, max_mmr, games_played, chicken_count")
      .filter("steam_id", "eq", steamId)
      .order("season", { ascending: true }),
    supabase
      .from("mmr_snapshots")
      .select("mmr, queen_rank, snapshotted_at")
      .filter("steam_id", "eq", steamId)
      .not("mmr", "is", null)
      .order("snapshotted_at", { ascending: false })
      .limit(60),
  ]);

  const seasons = (seasonsResult.data ?? []) as SeasonSnapshotRow[];
  const snapshots = (snapshotsResult.data ?? []) as Array<{
    mmr: number | null;
    queen_rank: number | null;
    snapshotted_at: string;
  }>;

  return {
    seasons,
    mmr_history: snapshots.map((row) => ({
      mmr: row.mmr,
      snapshotted_at: row.snapshotted_at,
    })),
    queen_rank_history: snapshots
      .map((row) => ({
        queen_rank: typeof row.queen_rank === "number" ? row.queen_rank : null,
        snapshotted_at: row.snapshotted_at,
      }))
      .filter(
        (row): row is { queen_rank: number; snapshotted_at: string } =>
          row.queen_rank != null
      ),
  };
}

async function cachedPayload(
  supabase: SupabaseClient,
  row: CachedUserDrodoRow,
  refreshPending = false
): Promise<DrodoProfilePayload | null> {
  const profile = cachedUserToDrodoProfile(row);
  const history = await loadDrodoHistory(supabase, profile.steam_id);
  if (!hasDrodoStats(profile, history.seasons)) return null;
  return {
    ...profile,
    ...history,
    ...(refreshPending ? { refresh_pending: true } : {}),
  };
}

async function claimProfileRefreshLease(
  supabase: SupabaseClient,
  steamId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_app_lock", {
    p_key: `drodo_profile:${steamId}`,
    p_ttl_seconds: Math.ceil(PROFILE_REFRESH_LOCK_TTL_MS / 1000),
  });
  if (error) {
    console.error("Failed to claim Drodo profile refresh lock:", error.message);
    return false;
  }
  return data === true;
}

async function refreshedPayload(
  supabase: SupabaseClient | null,
  result: Extract<FetchDrodoResult, { ok: true }>
): Promise<DrodoProfilePayload> {
  if (!supabase) {
    return {
      ...result.profile,
      seasons: result.seasonRows,
      mmr_history: [],
      queen_rank_history: [],
    };
  }
  return {
    ...result.profile,
    ...(await loadDrodoHistory(supabase, result.profile.steam_id)),
  };
}

export async function readThroughDrodoProfile({
  steamId,
  supabase,
  forceRefresh = false,
  snapshotOnSuccess = true,
  pollMode,
  hotPoll,
  cachedRow,
  onQueenChange,
}: ReadThroughDrodoProfileOptions): Promise<ReadThroughDrodoProfileResult> {
  if (!supabase) {
    const result = await fetchAndCacheDrodo(steamId, null, {
      snapshotOnSuccess,
      pollMode: pollMode ?? "reset",
      hotPoll,
      onQueenChange,
    });
    if (result.ok) {
      return {
        kind: "profile",
        source: "drodo",
        payload: await refreshedPayload(null, result),
      };
    }
    if (result.kind === "missing") {
      return {
        kind: "missing",
        source: "drodo",
        error: result.error,
        fetched_at: result.fetchedAt ?? new Date(0).toISOString(),
      };
    }
    return {
      kind: "upstream_error",
      error: result.error,
      ...(result.status ? { status: result.status } : {}),
    };
  }

  const row = cachedRow ?? (await loadCachedDrodoRow(supabase, steamId));
  if (!forceRefresh && row?.drodo_profile_missing) {
    if (isFreshCache(row.drodo_last_fetched_at, true)) {
      return {
        kind: "missing",
        source: "cache",
        error: EMPTY_DRODO_PROFILE_ERROR,
        fetched_at: row.drodo_last_fetched_at ?? new Date(0).toISOString(),
      };
    }
  }

  if (!forceRefresh && row && isFreshCache(row.drodo_last_fetched_at, false)) {
    const payload = await cachedPayload(supabase, row);
    if (payload) {
      return { kind: "profile", source: "cache", payload };
    }
    await purgeDrodoCache(steamId, supabase);
  }

  const stalePayload =
    row && !row.drodo_profile_missing
      ? await cachedPayload(supabase, row, true)
      : null;

  if (!(await claimProfileRefreshLease(supabase, steamId))) {
    if (stalePayload) {
      return { kind: "profile", source: "stale", payload: stalePayload };
    }
    return { kind: "refresh_in_progress" };
  }

  const result = await fetchAndCacheDrodo(steamId, supabase, {
    snapshotOnSuccess,
    onQueenChange,
    pollMode: pollMode ?? (row ? "adaptive" : "reset"),
    hotPoll: hotPoll ?? isCachedQueenProfile(row),
  });

  if (result.ok) {
    return {
      kind: "profile",
      source: "drodo",
      payload: await refreshedPayload(supabase, result),
    };
  }
  if (result.kind === "missing") {
    return {
      kind: "missing",
      source: "drodo",
      error: result.error,
      fetched_at: result.fetchedAt ?? new Date(0).toISOString(),
    };
  }
  return {
    kind: "upstream_error",
    error: result.error,
    ...(result.status ? { status: result.status } : {}),
    ...(stalePayload ? { stale: stalePayload } : {}),
  };
}
