/**
 * Twitch Extension rank endpoint.
 *
 * Returns a compact payload with the broadcaster player's current rank. The
 * panel intentionally renders this directly and does not include match history.
 *
 * Requires a Twitch Extension JWT; cached at the edge for 30 minutes.
 */
import { createSupabaseServerClient } from "@/lib/supabase";
import { verifyTwitchExtensionRequest } from "@/lib/twitchExtensionAuth";
import {
  fetchTwitchStats,
  TwitchStatsError,
  type TwitchStatsResponse,
} from "@/lib/twitchStats";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-JWT",
};

const TWITCH_CACHE_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ steamId: string }> }
) {
  try {
    const auth = verifyTwitchExtensionRequest(req);
    if (!auth) {
      return Response.json(
        { error: "Invalid Twitch Extension token" },
        { status: 401, headers: CORS_HEADERS }
      );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Twitch Extension auth is not configured";
    return Response.json(
      { error: message },
      { status: 503, headers: CORS_HEADERS }
    );
  }

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
