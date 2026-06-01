import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchAndCacheDrodo } from "@/lib/drodo";

const REPOLL_BATCH_SIZE = 50;
const SEED_BATCH_SIZE = 20;

interface DueUser {
  steam_id: string;
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

  const { data: dueUsers, error: queryError } = await supabase
    .from("users")
    .select("steam_id::text")
    .lte("next_poll_at", new Date().toISOString())
    .not("drodo_last_fetched_at", "is", null)
    .order("next_poll_at", { ascending: true })
    .limit(REPOLL_BATCH_SIZE);

  if (queryError) {
    return Response.json({ error: queryError.message }, { status: 500 });
  }

  const { data: unseededUsers } = await supabase
    .from("users")
    .select("steam_id::text")
    .is("drodo_last_fetched_at", null)
    .order("created_at", { ascending: false })
    .limit(SEED_BATCH_SIZE);

  const ids = ((dueUsers ?? []) as unknown as DueUser[]).map((row) =>
    String(row.steam_id)
  );
  const seedIds = ((unseededUsers ?? []) as unknown as DueUser[])
    .map((row) => String(row.steam_id))
    .filter((id) => !ids.includes(id));

  const results: Array<{
    steam_id: string;
    outcome: "ok" | "missing" | "upstream_error";
    seeded?: boolean;
    error?: string;
  }> = [];

  for (const steamId of ids) {
    const result = await fetchAndCacheDrodo(steamId, supabase, {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
    });
    if (result.ok) {
      results.push({ steam_id: steamId, outcome: "ok" });
    } else {
      results.push({
        steam_id: steamId,
        outcome: result.kind,
        error: result.error,
      });
    }
  }

  for (const steamId of seedIds) {
    const result = await fetchAndCacheDrodo(steamId, supabase, {
      snapshotOnSuccess: true,
      pollMode: "reset",
    });
    if (result.ok) {
      results.push({ steam_id: steamId, outcome: "ok", seeded: true });
    } else {
      results.push({
        steam_id: steamId,
        outcome: result.kind,
        seeded: true,
        error: result.error,
      });
    }
  }

  return Response.json({
    polled: results.length,
    repolled: ids.length,
    seeded: seedIds.length,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
