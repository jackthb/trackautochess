import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAndCacheDrodoBatch } from "@/lib/drodo";
import { revalidateQueenPages } from "@/lib/queensRevalidate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

const DEFAULT_POLL_BATCH_SIZE = 5;

interface DueUser {
  steam_id: string;
}

function pollBatchSize(): number {
  const parsed = Number(process.env.DRODO_POLL_BATCH_SIZE);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_POLL_BATCH_SIZE;
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
  const supabase = createSupabaseServiceRoleClient() as SupabaseClient;
  const pollBatchSizeLimit = pollBatchSize();

  const { data: users, error: queryError } = await supabase
    .from("users")
    .select("steam_id::text")
    .eq("drodo_profile_missing", false)
    .order("drodo_last_fetched_at", { ascending: true, nullsFirst: true })
    .limit(pollBatchSizeLimit);

  if (queryError) {
    return Response.json({ error: queryError.message }, { status: 500 });
  }

  const ids = ((users ?? []) as unknown as DueUser[]).map((row) =>
    String(row.steam_id)
  );

  const results: Array<{
    steam_id: string;
    outcome: "ok" | "missing" | "upstream_error";
    error?: string;
  }> = [];

  const pollResults = await fetchAndCacheDrodoBatch(ids, supabase, {
    snapshotOnSuccess: true,
    pollMode: "adaptive",
    onQueenChange: revalidateQueenPages,
  });
  for (const result of pollResults) {
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
    batch_size: pollBatchSizeLimit,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
