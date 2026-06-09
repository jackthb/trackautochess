import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchAndCacheDrodoBatch } from "@/lib/drodo";

const POLL_BATCH_SIZE = 200;
const RECENT_SIGN_IN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const GENERAL_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GENERAL_SCAN_CANDIDATE_MULTIPLIER = 4;

interface DueUser {
  steam_id: string;
}

interface GeneralScanUser extends DueUser {
  steam_signed_in_at: string | null;
  queen_ladder_last_seen_at: string | null;
  drodo_raw_data: Record<string, unknown> | null;
}

function hasQueenRank(rawData: Record<string, unknown> | null): boolean {
  if (!rawData) return false;
  const value = rawData.queen_rank;
  return value != null && String(value).trim() !== "";
}

function isActiveSyncUser(
  user: GeneralScanUser,
  recentSignInCutoff: string
): boolean {
  return (
    (user.steam_signed_in_at != null &&
      user.steam_signed_in_at >= recentSignInCutoff) ||
    user.queen_ladder_last_seen_at != null ||
    hasQueenRank(user.drodo_raw_data)
  );
}

async function handle(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const now = new Date();
  const recentSignInCutoff = new Date(
    now.getTime() - RECENT_SIGN_IN_WINDOW_MS
  ).toISOString();
  const generalScanCutoff = new Date(
    now.getTime() - GENERAL_SCAN_INTERVAL_MS
  ).toISOString();
  const activeSyncFilter = `steam_signed_in_at.gte.${recentSignInCutoff},queen_ladder_last_seen_at.not.is.null,drodo_raw_data->>queen_rank.not.is.null`;

  const { data: dueUsers, error: queryError } = await supabase
    .from("users")
    .select("steam_id::text")
    .or(activeSyncFilter)
    .lte("next_poll_at", now.toISOString())
    .not("drodo_last_fetched_at", "is", null)
    .order("next_poll_at", { ascending: true })
    .limit(POLL_BATCH_SIZE);

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
    .limit(POLL_BATCH_SIZE);

  const { data: generalScanUsers, error: generalScanError } = await supabase
    .from("users")
    .select(
      "steam_id::text, steam_signed_in_at, queen_ladder_last_seen_at, drodo_raw_data"
    )
    .not("drodo_last_fetched_at", "is", null)
    .lte("drodo_last_fetched_at", generalScanCutoff)
    .order("drodo_last_fetched_at", { ascending: true })
    .limit(POLL_BATCH_SIZE * GENERAL_SCAN_CANDIDATE_MULTIPLIER);

  if (generalScanError) {
    return Response.json({ error: generalScanError.message }, { status: 500 });
  }

  const ids = ((dueUsers ?? []) as unknown as DueUser[]).map((row) =>
    String(row.steam_id)
  );
  const seedIds = ((unseededUsers ?? []) as unknown as DueUser[])
    .map((row) => String(row.steam_id))
    .filter((id) => !ids.includes(id));
  const alreadyQueued = new Set([...ids, ...seedIds]);
  const generalIds = ((generalScanUsers ?? []) as unknown as GeneralScanUser[])
    .filter((row) => !isActiveSyncUser(row, recentSignInCutoff))
    .map((row) => String(row.steam_id))
    .filter((id) => {
      if (alreadyQueued.has(id)) return false;
      alreadyQueued.add(id);
      return true;
    })
    .slice(0, POLL_BATCH_SIZE);

  const results: Array<{
    steam_id: string;
    outcome: "ok" | "missing" | "upstream_error";
    seeded?: boolean;
    error?: string;
  }> = [];

  const repollResults = await fetchAndCacheDrodoBatch(ids, supabase, {
    snapshotOnSuccess: true,
    pollMode: "adaptive",
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

  const generalResults = await fetchAndCacheDrodoBatch(generalIds, supabase, {
    snapshotOnSuccess: true,
    pollMode: "adaptive",
  });
  for (const result of generalResults) {
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
    general: generalIds.length,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
