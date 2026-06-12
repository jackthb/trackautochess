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

let inFlight: Promise<QueensRefreshSummary> | null = null;

async function runQueensRefresh(
  supabase: SupabaseClient,
  options: RefreshOptions
): Promise<QueensRefreshSummary> {
  // Match /queens exactly: same candidate query, ordering, tiebreakers,
  // dedupe, and visible-table cap. If a row is displayed, this can refresh it.
  const rows = selectDisplayedQueens(await loadQueenCandidates(supabase));
  if (rows.length === 0) {
    return { polled: 0, ok: 0, missing: 0, upstream_error: 0 };
  }

  const floorMs = options.floorMs ?? QUEENS_REFRESH_COOLDOWN_MS;
  const hasNeverFetchedRow = rows.some((row) => !row.drodo_last_fetched_at);
  let newestFetchMs = -Infinity;
  for (const row of rows) {
    if (!row.drodo_last_fetched_at) continue;
    const fetchedMs = new Date(row.drodo_last_fetched_at).getTime();
    if (Number.isFinite(fetchedMs) && fetchedMs > newestFetchMs) {
      newestFetchMs = fetchedMs;
    }
  }
  if (!hasNeverFetchedRow && Date.now() - newestFetchMs < floorMs) {
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
