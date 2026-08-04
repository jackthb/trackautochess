import { RateLimiterMemory } from "rate-limiter-flexible";
import { openApiRoute } from "@/lib/apiGuard";
import { refreshDisplayedQueens } from "@/lib/queensRefresh";
import { revalidateQueenPages } from "@/lib/queensRevalidate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import {
  QUEENS_DRODO_VIEW_REFRESH_ENABLED,
  QUEENS_VIEW_REFRESH_COOLDOWN_MS,
} from "@/lib/queensVisitor";

// Kept for when Drodo returns queen_rank / season MMR again. While
// QUEENS_DRODO_VIEW_REFRESH_ENABLED is false, /queens shows the saved ladder
// capture and this route no-ops.
const ipRateLimiter = new RateLimiterMemory({ points: 30, duration: 60 });

export async function POST(req: Request) {
  const path = "/api/queens/refresh";
  if (!QUEENS_DRODO_VIEW_REFRESH_ENABLED) {
    return Response.json({
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

  const gate = await openApiRoute(req, { path, limiter: ipRateLimiter });
  if (!gate.ok) return gate.response;

  const supabase = createSupabaseServiceRoleClient();
  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const summary = await refreshDisplayedQueens(supabase, {
      floorMs: QUEENS_VIEW_REFRESH_COOLDOWN_MS,
      onQueenChange: revalidateQueenPages,
    });
    if (summary.checked_at) {
      revalidateQueenPages();
    }
    return Response.json(summary);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to refresh Queen players";
    console.error("Queens refresh failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
