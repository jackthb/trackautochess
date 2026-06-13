import { refreshDisplayedQueens } from "@/lib/queensRefresh";
import { revalidateQueenPages } from "@/lib/queensRevalidate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { QUEENS_VIEW_REFRESH_COOLDOWN_MS } from "@/lib/queensVisitor";

const HOURLY_REFRESH_FLOOR_MS = 60 * 60 * 1000;

async function handle(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();
  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const summary = await refreshDisplayedQueens(supabase, {
    floorMs: HOURLY_REFRESH_FLOOR_MS,
    lockTtlMs: QUEENS_VIEW_REFRESH_COOLDOWN_MS,
    onQueenChange: revalidateQueenPages,
  });

  if (summary.ok > 0) {
    revalidateQueenPages();
  }

  return Response.json({
    mode: "hourly",
    ...summary,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
