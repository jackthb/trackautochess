import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAndCacheDrodoBatch, summarizeDrodoResults } from "@/lib/drodo";
import { loadQueenCandidates, selectDisplayedQueens } from "@/lib/queens";
import { QUEENS_REFRESH_COOLDOWN_MS } from "@/lib/queensVisitor";

export interface QueensRefreshSummary {
  polled: number;
  ok: number;
  missing: number;
  upstream_error: number;
}

interface RefreshOptions {
  floorMs?: number;
  onQueenChange?: () => void;
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
  if (!(await claimRefreshLease(supabase, floorMs))) {
    return { polled: 0, ok: 0, missing: 0, upstream_error: 0 };
  }

  // Match /queens exactly: same candidate query, ordering, tiebreakers,
  // dedupe, and visible-table cap. If a row is displayed, this can refresh it.
  const rows = selectDisplayedQueens(await loadQueenCandidates(supabase));
  if (rows.length === 0) {
    return { polled: 0, ok: 0, missing: 0, upstream_error: 0 };
  }

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
    return { polled: 0, ok: 0, missing: 0, upstream_error: 0 };
  }

  const results = await fetchAndCacheDrodoBatch(
    rows.map((row) => row.steam_id),
    supabase,
    {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
      hotPoll: true,
      onQueenChange: options.onQueenChange,
    }
  );
  const summary = summarizeDrodoResults(results);
  return { polled: rows.length, ...summary };
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
