import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activePollOrFilter,
  inactivePollCutoff,
  isActivePollUser,
  recentSignInCutoff,
} from "@dac/shared/drodo-core";
import { fetchAndCacheDrodoBatch } from "@/lib/drodo";
import { DRODO_LIVE_FETCH_ENABLED } from "@/lib/drodoLive";
import { revalidateQueenPages } from "@/lib/queensRevalidate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

const DEFAULT_POLL_BATCH_SIZE = 200;
const INACTIVE_SCAN_CANDIDATE_MULTIPLIER = 4;

interface DueUser {
  steam_id: string;
}

interface InactiveScanUser extends DueUser {
  steam_signed_in_at: string | null;
  queen_ladder_rank: number | null;
  queen_ladder_last_seen_at: string | null;
  poll_interval_seconds: number | null;
}

function pollBatchSize(): number {
  const parsed = Number(process.env.DRODO_POLL_BATCH_SIZE);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_POLL_BATCH_SIZE;
}

function isActiveSyncUser(
  user: InactiveScanUser,
  cutoffIso: string
): boolean {
  return isActivePollUser(user, cutoffIso);
}

async function handle(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!DRODO_LIVE_FETCH_ENABLED) {
    return Response.json({
      disabled: true,
      reason:
        "Drodo live fetch is parked — public courier no longer returns season MMR.",
      polled: 0,
      repolled: 0,
      seeded: 0,
      inactive_daily: 0,
      results: [],
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }
  const supabase = createSupabaseServiceRoleClient() as SupabaseClient;
  const now = new Date();
  const pollBatchSizeLimit = pollBatchSize();
  const recentSignIn = recentSignInCutoff(now);
  const inactiveScanCutoff = inactivePollCutoff(now);
  const activeSyncFilter = activePollOrFilter(recentSignIn);

  const { data: dueUsers, error: queryError } = await supabase
    .from("users")
    .select("steam_id::text")
    .or(activeSyncFilter)
    .lte("next_poll_at", now.toISOString())
    .not("drodo_last_fetched_at", "is", null)
    .order("next_poll_at", { ascending: true })
    .limit(pollBatchSizeLimit);

  if (queryError) {
    return Response.json({ error: queryError.message }, { status: 500 });
  }

  const { data: unseededUsers } = await supabase
    .from("users")
    .select("steam_id::text")
    .or(activeSyncFilter)
    .is("drodo_last_fetched_at", null)
    .order("queen_ladder_last_seen_at", { ascending: false, nullsFirst: false })
    .order("steam_signed_in_at", { ascending: false, nullsFirst: false })
    .limit(pollBatchSizeLimit);

  const { data: inactiveScanUsers, error: inactiveScanError } = await supabase
    .from("users")
    .select(
      "steam_id::text, steam_signed_in_at, queen_ladder_rank, queen_ladder_last_seen_at, poll_interval_seconds"
    )
    .eq("drodo_profile_missing", false)
    .not("drodo_last_fetched_at", "is", null)
    .lte("drodo_last_fetched_at", inactiveScanCutoff)
    .order("drodo_last_fetched_at", { ascending: true })
    .limit(pollBatchSizeLimit * INACTIVE_SCAN_CANDIDATE_MULTIPLIER);

  if (inactiveScanError) {
    return Response.json({ error: inactiveScanError.message }, { status: 500 });
  }

  const ids = ((dueUsers ?? []) as unknown as DueUser[]).map((row) =>
    String(row.steam_id)
  );
  const seedIds = ((unseededUsers ?? []) as unknown as DueUser[])
    .map((row) => String(row.steam_id))
    .filter((id) => !ids.includes(id));
  const alreadyQueued = new Set([...ids, ...seedIds]);
  const inactiveIds = ((inactiveScanUsers ?? []) as unknown as InactiveScanUser[])
    .filter((row) => !isActiveSyncUser(row, recentSignIn))
    .map((row) => String(row.steam_id))
    .filter((id) => {
      if (alreadyQueued.has(id)) return false;
      alreadyQueued.add(id);
      return true;
    })
    .slice(0, pollBatchSizeLimit);

  const results: Array<{
    steam_id: string;
    outcome: "ok" | "missing" | "upstream_error";
    seeded?: boolean;
    error?: string;
  }> = [];

  const repollResults = await fetchAndCacheDrodoBatch(ids, supabase, {
    snapshotOnSuccess: true,
    pollMode: "adaptive",
    hotPoll: true,
    onQueenChange: revalidateQueenPages,
  });
  for (const result of repollResults) {
    if (result.ok) {
      results.push({ steam_id: result.steam_id, outcome: "ok" });
    } else {
      results.push({
        steam_id: result.steam_id,
        outcome: result.kind,
        error: result.error,
      });
    }
  }

  const seedResults = await fetchAndCacheDrodoBatch(seedIds, supabase, {
    snapshotOnSuccess: true,
    pollMode: "reset",
    hotPoll: true,
    onQueenChange: revalidateQueenPages,
  });
  for (const result of seedResults) {
    if (result.ok) {
      results.push({ steam_id: result.steam_id, outcome: "ok", seeded: true });
    } else {
      results.push({
        steam_id: result.steam_id,
        outcome: result.kind,
        seeded: true,
        error: result.error,
      });
    }
  }

  const inactiveResults = await fetchAndCacheDrodoBatch(inactiveIds, supabase, {
    snapshotOnSuccess: true,
    pollMode: "adaptive",
    onQueenChange: revalidateQueenPages,
  });
  for (const result of inactiveResults) {
    if (result.ok) {
      results.push({ steam_id: result.steam_id, outcome: "ok" });
    } else {
      results.push({
        steam_id: result.steam_id,
        outcome: result.kind,
        error: result.error,
      });
    }
  }

  return Response.json({
    polled: results.length,
    repolled: ids.length,
    seeded: seedIds.length,
    inactive_daily: inactiveIds.length,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
