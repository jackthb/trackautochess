/**
 * Twitch Extension rank endpoint.
 *
 * Returns a compact payload with the broadcaster player's current rank. The
 * panel intentionally renders this directly and does not include match history.
 *
 * Public; CORS open; cached at the edge for 30 minutes.
 */
import { mmrToRank } from "@dac/shared/game-utils";
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  fetchSteamProfile,
  playerProfilePath,
  resolveSteamInput,
} from "@/lib/steam";

const SITE_HOST =
  process.env.NEXT_PUBLIC_SITE_HOST?.replace(/\/$/, "") ||
  "https://trackautochess.com";

interface StatsResponse {
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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const TWITCH_CACHE_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
};

function numberFromRawData(
  rawData: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  const value = rawData?.[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

  const steamId = await resolveSteamInput(raw, supabase, { persist: false });
  if (!steamId) {
    return Response.json(
      { error: "Player not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const [profile, drodoRes] = await Promise.all([
    fetchSteamProfile(steamId, supabase, { persist: false }),
    supabase
      .from("users")
      .select(
        "drodo_mmr, drodo_max_mmr, drodo_mmr_level, drodo_season, drodo_season_games, drodo_candy, drodo_chicken_count, drodo_profile_missing, drodo_raw_data, queen_ladder_rank"
      )
      .eq("steam_id", steamId)
      .maybeSingle(),
  ]);

  const drodo = drodoRes.data as {
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
  } | null;

  const hasStats = drodo && !drodo.drodo_profile_missing;
  const mmr = hasStats ? drodo.drodo_mmr : null;
  const queenLadderRank = hasStats
    ? (drodo.queen_ladder_rank ??
      numberFromRawData(drodo.drodo_raw_data, "queen_rank"))
    : null;

  const payload: StatsResponse = {
    player: {
      steam_id: steamId,
      name: profile.name,
      avatar_url: profile.avatarUrl ?? null,
      profile_url: SITE_HOST + playerProfilePath(steamId, profile.customUrl),
    },
    stats: {
      mmr,
      max_mmr: hasStats ? drodo.drodo_max_mmr : null,
      season: hasStats ? drodo.drodo_season : null,
      season_games: hasStats ? drodo.drodo_season_games : null,
      candy: hasStats ? drodo.drodo_candy : null,
      chicken_count: hasStats ? drodo.drodo_chicken_count : null,
      rank: mmrToRank(mmr) || null,
      mmr_level: hasStats ? drodo.drodo_mmr_level : null,
      queen_ladder_rank: queenLadderRank,
    },
    generated_at: new Date().toISOString(),
  };

  return Response.json(payload, {
    status: 200,
    headers: TWITCH_CACHE_HEADERS,
  });
}
