import { mmrToRank } from "@dac/shared/game-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSteamProfile,
  playerProfilePath,
  resolveSteamInput,
} from "@/lib/steam";

const SITE_HOST =
  process.env.NEXT_PUBLIC_SITE_HOST?.replace(/\/$/, "") ||
  "https://www.trackautochess.com";

export interface TwitchStatsResponse {
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

export class TwitchStatsError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "TwitchStatsError";
  }
}

export async function fetchTwitchStats(
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
  const mmr = hasStats ? (drodo?.drodo_mmr ?? null) : null;
  const queenLadderRank = hasStats ? (drodo?.queen_ladder_rank ?? null) : null;

  return {
    player: {
      steam_id: steamId,
      name: profile.name,
      avatar_url: profile.avatarUrl ?? null,
      profile_url: SITE_HOST + playerProfilePath(steamId, profile.customUrl),
    },
    stats: {
      mmr,
      max_mmr: hasStats ? (drodo?.drodo_max_mmr ?? null) : null,
      season: hasStats ? (drodo?.drodo_season ?? null) : null,
      season_games: hasStats ? (drodo?.drodo_season_games ?? null) : null,
      candy: hasStats ? (drodo?.drodo_candy ?? null) : null,
      chicken_count: hasStats ? (drodo?.drodo_chicken_count ?? null) : null,
      rank: mmrToRank(mmr) || null,
      mmr_level: hasStats ? (drodo?.drodo_mmr_level ?? null) : null,
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
      : "MMR unavailable";

  return [
    displayName,
    `Steam ID: ${stats.player.steam_id}`,
    mmrText,
    `Profile: ${stats.player.profile_url}`,
  ].join(" | ");
}
