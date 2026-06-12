import type { NextApiRequest } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse, toIncomingHeaders } from "@/lib/abuseLog";
import { fetchAndCacheDrodoBatch, summarizeDrodoResults } from "@/lib/drodo";
import { loadQueenCandidates, selectDisplayedQueens } from "@/lib/queens";
import { revalidateQueensPage } from "@/lib/queensRevalidate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

// Viewing /queens pings this endpoint and every tracked Queen is re-fetched
// from Drodo on the spot — page viewers are what keep the table in sync, with
// the hourly background poll as the safety net for hours nobody is watching.
// Unauthenticated by design (it is called from the public page); the whole
// run costs one Drodo courier request, concurrent calls share a single run,
// the micro-floor below bounds how often runs can happen at all, and the
// per-IP limit caps how often one client can trigger the route.

// DB-backed floor between runs. The in-flight promise only dedupes within one
// server instance; checking the newest fetch timestamp dedupes across
// instances and caps what a parked tab's ping interval can cost — while a
// fresh page view still sees data at most this old, which reads as instant.
const REFRESH_MICRO_FLOOR_MS = 60 * 1000;

const ipRateLimiter = new RateLimiterMemory({ points: 30, duration: 60 });

interface RefreshSummary {
  polled: number;
  ok: number;
  missing: number;
  upstream_error: number;
}

// Concurrent visitors share one refresh run per server instance; the DB gate
// covers the cross-instance case.
let inFlight: Promise<RefreshSummary> | null = null;

async function refreshQueens(supabase: SupabaseClient): Promise<RefreshSummary> {
  // Match /queens exactly: same candidate query, ordering, tiebreakers,
  // dedupe, and visible-table cap. If a row is displayed, this can refresh it.
  // That intentionally includes displayed missing rows: a visible row should
  // not age forever, and the micro-floor bounds the retry cost.
  const rows = selectDisplayedQueens(await loadQueenCandidates(supabase));
  if (rows.length === 0) {
    return { polled: 0, ok: 0, missing: 0, upstream_error: 0 };
  }

  const hasNeverFetchedRow = rows.some((row) => !row.drodo_last_fetched_at);
  let newestFetchMs = -Infinity;
  for (const row of rows) {
    if (!row.drodo_last_fetched_at) continue;
    const fetchedMs = new Date(row.drodo_last_fetched_at).getTime();
    if (Number.isFinite(fetchedMs) && fetchedMs > newestFetchMs) {
      newestFetchMs = fetchedMs;
    }
  }
  if (!hasNeverFetchedRow && Date.now() - newestFetchMs < REFRESH_MICRO_FLOOR_MS) {
    return { polled: 0, ok: 0, missing: 0, upstream_error: 0 };
  }

  const ids = rows.map((row) => row.steam_id);

  const results = await fetchAndCacheDrodoBatch(ids, supabase, {
    snapshotOnSuccess: true,
    pollMode: "adaptive",
    hotPoll: true,
    onQueenChange: revalidateQueensPage,
  });
  const summary = summarizeDrodoResults(results);

  // onQueenChange already rebuilt /queens for stat changes; rebuild on a
  // no-change fetch too so the page's "Last updated" stamp reflects this run.
  if (summary.ok > 0) {
    revalidateQueensPage();
  }

  return { polled: ids.length, ...summary };
}

export async function POST(req: Request) {
  const path = "/api/queens/refresh";
  const nodeHeaders = toIncomingHeaders(req);
  const reqShim = { headers: nodeHeaders } as unknown as NextApiRequest;
  const ip = getClientIp(reqShim);
  const ua = getUserAgent(reqShim);

  const botCheck = await checkBotId({
    advancedOptions: { headers: nodeHeaders },
  });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    logAbuse("bot_blocked", { path, ip, ua });
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await ipRateLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip, ua });
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = createSupabaseServiceRoleClient() as SupabaseClient | null;
  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    if (!inFlight) {
      inFlight = refreshQueens(supabase).finally(() => {
        inFlight = null;
      });
    }
    const summary = await inFlight;
    return Response.json(summary);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to refresh Queen players";
    console.error("Queens refresh failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
