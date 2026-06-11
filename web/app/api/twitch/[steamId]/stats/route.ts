/**
 * Twitch Extension rank endpoint.
 *
 * Returns a compact payload with the broadcaster player's current rank. The
 * panel intentionally renders this directly and does not include match history.
 *
 * Public; CORS open; cached at the edge for 30 minutes.
 */
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  fetchTwitchStats,
  TwitchStatsError,
  type TwitchStatsResponse,
} from "@/lib/twitchStats";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const TWITCH_CACHE_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ steamId: string }> }
) {
  const { steamId: raw } = await ctx.params;
  if (!raw) {
    return Response.json(
      { error: "steamId required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase not configured" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let payload: TwitchStatsResponse;
  try {
    payload = await fetchTwitchStats(raw, supabase);
  } catch (error) {
    const status = error instanceof TwitchStatsError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to load stats";
    return Response.json(
      { error: message },
      { status, headers: CORS_HEADERS }
    );
  }

  return Response.json(payload, {
    status: 200,
    headers: TWITCH_CACHE_HEADERS,
  });
}
