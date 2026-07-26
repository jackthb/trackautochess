import { mmrLevelToRank, mmrToRank } from "@dac/shared/game-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase";
import { DRODO_LIVE_FETCH_ENABLED } from "@/lib/drodoLive";
import {
  fetchSteamProfile,
  playerProfilePath,
  resolveSteamInput,
} from "@/lib/steam";

const SITE_HOST =
  process.env.NEXT_PUBLIC_SITE_HOST?.replace(/\/$/, "") ||
  "https://www.trackautochess.com";

interface TwitchStatsResponse {
  player: {
    steam_id: string;
    name: string | null;
    avatar_url: string | null;
    profile_url: string;
  };
  stats: {
    mmr: number | null;
    max_mmr: number | null;
    season: string | null;
    season_games: number | null;
    candy: number | null;
    chicken_count: number | null;
    rank: string | null;
    mmr_level: number | null;
    queen_ladder_rank: number | null;
  };
  generated_at: string;
}

interface UserDrodoStatsRow {
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number | null;
  drodo_profile_missing: boolean | null;
  drodo_raw_data: Record<string, unknown> | null;
  queen_ladder_rank: number | null;
}

class TwitchStatsError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "TwitchStatsError";
  }
}

async function fetchTwitchStats(
  rawSteamInput: string,
  supabase: SupabaseClient
): Promise<TwitchStatsResponse> {
  const steamId = await resolveSteamInput(rawSteamInput, supabase, {
    persist: false,
  });
  if (!steamId) {
    throw new TwitchStatsError("Player not found", 404);
  }

  const [profile, drodoRes] = await Promise.all([
    fetchSteamProfile(steamId, supabase, { persist: false }),
    supabase
      .from("users")
      .select(
        "drodo_mmr, drodo_max_mmr, drodo_mmr_level, drodo_season, drodo_season_games, drodo_candy, drodo_chicken_count, drodo_profile_missing, drodo_raw_data, queen_ladder_rank"
      )
      .filter("steam_id", "eq", steamId)
      .maybeSingle<UserDrodoStatsRow>(),
  ]);

  const drodo = drodoRes.data;
  const hasStats = Boolean(drodo && !drodo.drodo_profile_missing);
  const mmr = hasStats && DRODO_LIVE_FETCH_ENABLED ? (drodo?.drodo_mmr ?? null) : null;
  const mmrLevel = hasStats ? (drodo?.drodo_mmr_level ?? null) : null;
  const queenLadderRank = hasStats ? (drodo?.queen_ladder_rank ?? null) : null;
  const rank =
    (mmr != null ? mmrToRank(mmr) : null) ||
    mmrLevelToRank(mmrLevel) ||
    null;

  return {
    player: {
      steam_id: steamId,
      name: profile.name,
      avatar_url: profile.avatarUrl ?? null,
      profile_url: SITE_HOST + playerProfilePath(steamId, profile.customUrl),
    },
    stats: {
      mmr,
      max_mmr:
        hasStats && DRODO_LIVE_FETCH_ENABLED ? (drodo?.drodo_max_mmr ?? null) : null,
      season: hasStats ? (drodo?.drodo_season ?? null) : null,
      season_games: hasStats ? (drodo?.drodo_season_games ?? null) : null,
      candy: hasStats ? (drodo?.drodo_candy ?? null) : null,
      chicken_count: hasStats ? (drodo?.drodo_chicken_count ?? null) : null,
      rank,
      mmr_level: mmrLevel,
      queen_ladder_rank: queenLadderRank,
    },
    generated_at: new Date().toISOString(),
  };
}

export function formatTwitchMmrChatMessage(stats: TwitchStatsResponse): string {
  const displayName = stats.player.name?.trim() || stats.player.steam_id;
  const rankSuffix = stats.stats.rank ? ` (${stats.stats.rank})` : "";
  const mmrText =
    typeof stats.stats.mmr === "number"
      ? `${stats.stats.mmr.toLocaleString("en-US")} MMR${rankSuffix}`
      : stats.stats.rank
        ? `Rank: ${stats.stats.rank} — live MMR unavailable`
        : "MMR unavailable";

  return [
    displayName,
    `Steam ID: ${stats.player.steam_id}`,
    mmrText,
    `Profile: ${stats.player.profile_url}`,
  ].join(" | ");
}

// --- Plain-text chatbot endpoint plumbing -------------------------------
// Shared by /api/twitch/mmr (query param) and /api/twitch/[steamId]/mmr
// (path param). Chatbot URL-fetch variables generally only print the response
// body for HTTP 200 responses, so these always return user-facing text with
// 200, even when a player cannot be resolved or the backend is unavailable.

export const TWITCH_CHAT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CHATBOT_HEADERS = {
  ...TWITCH_CHAT_CORS_HEADERS,
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
  "Content-Type": "text/plain; charset=utf-8",
};

export function twitchChatTextResponse(message: string): Response {
  return new Response(message, { status: 200, headers: CHATBOT_HEADERS });
}

export function twitchChatOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: TWITCH_CHAT_CORS_HEADERS });
}

/**
 * Resolve a raw Steam input (ID64, vanity name, or profile URL) and return
 * the one-line MMR chat message as a plain-text Response.
 */
export async function twitchMmrChatResponse(rawSteamInput: string): Promise<Response> {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return twitchChatTextResponse(
      "Track Auto Chess stats are temporarily unavailable."
    );
  }

  try {
    const stats = await fetchTwitchStats(rawSteamInput, supabase);
    return twitchChatTextResponse(formatTwitchMmrChatMessage(stats));
  } catch (error) {
    if (error instanceof TwitchStatsError && error.status === 404) {
      return twitchChatTextResponse(
        "Player not found. Try a Steam ID64, Steam profile URL, or Steam vanity name."
      );
    }
    return twitchChatTextResponse(
      "Track Auto Chess stats are temporarily unavailable."
    );
  }
}
