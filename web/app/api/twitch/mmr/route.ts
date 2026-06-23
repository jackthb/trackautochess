/**
 * Plain-text Twitch chatbot endpoint using a query parameter.
 *
 * This is easier to wire into bot marketplaces/custom commands than the
 * path-based endpoint because full Steam profile URLs only need query escaping:
 * /api/twitch/mmr?steam=<Steam ID, vanity name, or Steam profile URL>
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

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("steam")?.trim();
  if (!raw) {
    return textResponse(
      "Usage: !mmr <Steam ID64, Steam profile URL, or Steam vanity name>"
    );
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
