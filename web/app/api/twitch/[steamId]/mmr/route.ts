/**
 * Plain-text Twitch chatbot endpoint.
 *
 * Add the URL to a Twitch bot custom command such as Nightbot or
 * StreamElements. For example, an `!mmr` command can urlfetch this endpoint and
 * print the returned one-line Steam ID/profile/MMR summary directly in chat.
 *
 * Chatbot URL-fetch variables generally only print the response body for HTTP
 * 200 responses, so this endpoint returns user-facing text with 200 even when a
 * player cannot be resolved or the stats backend is temporarily unavailable.
 */
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  fetchTwitchStats,
  formatTwitchMmrChatMessage,
  TwitchStatsError,
} from "@/lib/twitchStats";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CHATBOT_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
  "Content-Type": "text/plain; charset=utf-8",
};

function textResponse(message: string, status = 200): Response {
  return new Response(message, {
    status,
    headers: CHATBOT_HEADERS,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ steamId: string }> }
) {
  const { steamId: raw } = await ctx.params;
  if (!raw) {
    return textResponse("Steam ID required.");
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return textResponse("Track Auto Chess stats are temporarily unavailable.");
  }

  try {
    const stats = await fetchTwitchStats(raw, supabase);
    return textResponse(formatTwitchMmrChatMessage(stats));
  } catch (error) {
    if (error instanceof TwitchStatsError && error.status === 404) {
      return textResponse(
        "Player not found. Try a Steam ID64, Steam profile URL, or Steam vanity name."
      );
    }
    return textResponse("Track Auto Chess stats are temporarily unavailable.");
  }
}
