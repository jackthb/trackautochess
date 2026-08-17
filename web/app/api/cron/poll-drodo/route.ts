import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activePollOrFilter,
  inactivePollCutoff,
  isActivePollUser,
  recentSignInCutoff,
} from "@dac/shared/drodo-core";
import { requireCronAuth } from "@/lib/cronAuth";
import { fetchAndCacheDrodoBatch } from "@/lib/drodo";
import { DRODO_BACKGROUND_POLL_ENABLED } from "@/lib/drodoLive";
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

async function handle(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  if (!DRODO_BACKGROUND_POLL_ENABLED) {
    return Response.json({
      disabled: true,
      reason:
        "Scheduled Drodo polling is parked — ranks refresh on page hits instead.",
      polled: 0,
      repolled: 0,
      seeded: 0,
      inactive_daily: 0,
      results: [],
    });
  }

  // createSupabaseServiceRoleClient() already returns null when the URL or the
  // service-role key is missing, so one null check covers both.
  const supabase = createSupabaseServiceRoleClient() as SupabaseClient | null;
  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }
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
  // Set membership, matching the Cronicle poller — the two selections have to
  // agree on which ids count as already queued, and `ids` runs to the batch
  // size (200+), so a linear scan per candidate is the wrong shape here.
  const alreadyQueued = new Set(ids);
  const seedIds = ((unseededUsers ?? []) as unknown as DueUser[])
    .map((row) => String(row.steam_id))
    .filter((id) => {
      if (alreadyQueued.has(id)) return false;
      alreadyQueued.add(id);
      return true;
    });
  const inactiveIds = ((inactiveScanUsers ?? []) as unknown as InactiveScanUser[])
    .filter((row) => !isActivePollUser(row, recentSignIn))
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
