import type { NextApiRequest } from "next";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse, toIncomingHeaders } from "@/lib/abuseLog";
import { refreshDisplayedQueens } from "@/lib/queensRefresh";
import { revalidateQueenPages } from "@/lib/queensRevalidate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import { QUEENS_VIEW_REFRESH_COOLDOWN_MS } from "@/lib/queensVisitor";

// /queens renders cached rows quickly; visible tabs call this endpoint after
// the displayed countdown reaches zero so Drodo polling never blocks HTML.
const ipRateLimiter = new RateLimiterMemory({ points: 30, duration: 60 });

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
