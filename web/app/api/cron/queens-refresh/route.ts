import { requireCronAuth } from "@/lib/cronAuth";
import { refreshDisplayedQueens } from "@/lib/queensRefresh";
import { revalidateQueenPages } from "@/lib/queensRevalidate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import {
  QUEENS_DRODO_VIEW_REFRESH_ENABLED,
  QUEENS_VIEW_REFRESH_COOLDOWN_MS,
} from "@/lib/queensVisitor";

async function handle(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  if (!QUEENS_DRODO_VIEW_REFRESH_ENABLED) {
    return Response.json({
      mode: "five-minute",
      disabled: true,
      reason:
        "Queen Drodo view refresh is off; /queens shows the saved ladder capture.",
      polled: 0,
      ok: 0,
      missing: 0,
      upstream_error: 0,
      changed: 0,
      checked_at: null,
    });
  }

  const supabase = createSupabaseServiceRoleClient();
  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const summary = await refreshDisplayedQueens(supabase, {
    floorMs: QUEENS_VIEW_REFRESH_COOLDOWN_MS,
    lockTtlMs: QUEENS_VIEW_REFRESH_COOLDOWN_MS,
    onQueenChange: revalidateQueenPages,
  });

  if (summary.checked_at) {
    revalidateQueenPages();
  }

  return Response.json({
    mode: "five-minute",
    ...summary,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
