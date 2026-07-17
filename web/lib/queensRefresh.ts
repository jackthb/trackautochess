import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAndCacheDrodoBatch, summarizeDrodoResults } from "@/lib/drodo";
import {
  hydrateQueenSteamProfiles,
  loadQueenCandidates,
  selectQueensRefreshRows,
} from "@/lib/queens";
import type { QueenRevalidationTarget } from "@/lib/queensRevalidate";
import { QUEENS_REFRESH_COOLDOWN_MS } from "@/lib/queensVisitor";

export interface QueensRefreshSummary {
  polled: number;
  ok: number;
  missing: number;
  upstream_error: number;
  changed: number;
  checked_at: string | null;
}

interface RefreshOptions {
  floorMs?: number;
  lockTtlMs?: number;
  onQueenChange?: (target: QueenRevalidationTarget) => void;
}

const QUEENS_REFRESH_LOCK_KEY = "queens_refresh";

let inFlight: Promise<QueensRefreshSummary> | null = null;

async function claimRefreshLease(
  supabase: SupabaseClient,
  ttlMs: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_app_lock", {
    p_key: QUEENS_REFRESH_LOCK_KEY,
    p_ttl_seconds: Math.max(1, Math.ceil(ttlMs / 1000)),
  });
  if (error) {
    console.error("Failed to claim Queens refresh lock:", error.message);
    return false;
  }
  return data === true;
}

async function runQueensRefresh(
  supabase: SupabaseClient,
  options: RefreshOptions
): Promise<QueensRefreshSummary> {
  const floorMs = options.floorMs ?? QUEENS_REFRESH_COOLDOWN_MS;

  // Refresh displayed rows plus every candidate involved in a duplicate
  // top-100 rank, so stale collisions get resolved instead of only hidden.
  let rows = selectQueensRefreshRows(await loadQueenCandidates(supabase));
  if (rows.length === 0) {
    return {
      polled: 0,
      ok: 0,
      missing: 0,
      upstream_error: 0,
      changed: 0,
      checked_at: null,
    };
  }

  let changed = 0;
  const identityRefresh = await hydrateQueenSteamProfiles(rows, supabase, {
    onProfileChange: (row) => {
      changed += 1;
      options.onQueenChange?.({
        steam_id: row.steam_id,
        custom_url: row.custom_url,
      });
    },
  });
  rows = identityRefresh.rows;

  const hasNeverFetchedRow = rows.some((row) => !row.drodo_last_fetched_at);
  let oldestFetchMs = Infinity;
  for (const row of rows) {
    if (!row.drodo_last_fetched_at) continue;
    const fetchedMs = new Date(row.drodo_last_fetched_at).getTime();
    if (Number.isFinite(fetchedMs) && fetchedMs < oldestFetchMs) {
      oldestFetchMs = fetchedMs;
    }
  }
  if (!hasNeverFetchedRow && Date.now() - oldestFetchMs < floorMs) {
    return {
      polled: 0,
      ok: 0,
      missing: 0,
      upstream_error: 0,
      changed,
      checked_at: changed > 0 ? new Date().toISOString() : null,
    };
  }

  if (!(await claimRefreshLease(supabase, options.lockTtlMs ?? floorMs))) {
    return {
      polled: 0,
      ok: 0,
      missing: 0,
      upstream_error: 0,
      changed,
      checked_at: changed > 0 ? new Date().toISOString() : null,
    };
  }

  const profileRoutes = new Map(
    rows.map((row) => [row.steam_id, row.custom_url] as const)
  );
  // persistDrodoProfile updates queen_ladder_rank when Drodo returns a rank;
  // null Drodo ranks leave capture-owned ranks alone.
  const results = await fetchAndCacheDrodoBatch(
    rows.map((row) => row.steam_id),
    supabase,
    {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
      hotPoll: true,
      onQueenChange: (profile) => {
        changed += 1;
        options.onQueenChange?.({
          steam_id: profile.steam_id,
          custom_url: profileRoutes.get(profile.steam_id) ?? null,
        });
      },
    }
  );
  const summary = summarizeDrodoResults(results);
  return {
    polled: rows.length,
    ...summary,
    changed,
    checked_at: new Date().toISOString(),
  };
}

export function refreshDisplayedQueens(
  supabase: SupabaseClient,
  options: RefreshOptions = {}
): Promise<QueensRefreshSummary> {
  if (!inFlight) {
    inFlight = runQueensRefresh(supabase, options).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
