import type { SupabaseClient } from "@supabase/supabase-js";
import { originFromUrl, SITE_TITLE } from "@/lib/site";
import { mmrLevelToRank, mmrToRank } from "@dac/shared/game-utils";
import { parseSteamId64, type SteamId64 } from "@dac/shared/steam";
import {
  lastTop3FromDrodoData,
  lastWinFromDrodoData,
  USER_DRODO_STAT_COLUMNS,
  type DrodoProfileRow,
  type UserDrodoStatsRow,
} from "@/lib/drodo";
import { DRODO_LIVE_FETCH_ENABLED } from "@/lib/drodoLive";
import {
  parseSteamInput,
  playerProfilePath,
  resolveSteamInput,
  steamProfileUrl,
  type SteamProfile,
} from "@/lib/steam";
import type { PlayerPageProps } from "./PlayerView";

/**
 * Shape a Drodo profile row into the stats object PlayerView renders. Shared
 * by the server page and the client background refresh so both paths produce
 * identical data.
 */
export function drodoStatsFromProfile(profile: DrodoProfileRow) {
  return {
    mmr: profile.mmr,
    max_mmr: profile.max_mmr,
    mmr_level: profile.mmr_level,
    queen_rank: profile.queen_rank,
    last_win_at: lastWinFromDrodoData(profile.raw_data),
    last_top3_at: lastTop3FromDrodoData(profile.raw_data),
    season: profile.season,
    season_games: profile.season_games,
    candy: profile.candy,
    chicken_count: profile.chicken_count,
  };
}

/** Cached Drodo stats plus the Steam profile columns the player page renders. */
export const PLAYER_PROFILE_DRODO_SELECT = [
  "name",
  "custom_url",
  "avatar_url",
  ...USER_DRODO_STAT_COLUMNS,
].join(", ");

export interface PlayerProfileDrodoRow extends UserDrodoStatsRow {
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
}

interface RouteUserRow extends PlayerProfileDrodoRow {
  steam_id: string;
}

export interface ResolvedPlayerRoute {
  steamId: SteamId64;
  cachedProfileRow: PlayerProfileDrodoRow | null;
}

export async function resolvePlayerRoute(
  rawSteamId: string,
  supabase: SupabaseClient | null
): Promise<ResolvedPlayerRoute | null> {
  const parsed = parseSteamInput(rawSteamId);
  if (!parsed) return null;
  if (parsed.kind === "id") {
    // Pull the cached row so the page can short-circuit the id→vanity redirect
    // before any heavy loading. The main load reuses this same row, so this is
    // not an extra query on the warm path.
    if (supabase) {
      const { data } = await supabase
        .from("users")
        .select(PLAYER_PROFILE_DRODO_SELECT)
        .filter("steam_id", "eq", parsed.value)
        .maybeSingle<PlayerProfileDrodoRow>();
      return { steamId: parsed.value, cachedProfileRow: data ?? null };
    }
    return { steamId: parsed.value, cachedProfileRow: null };
  }

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select(`steam_id::text, ${PLAYER_PROFILE_DRODO_SELECT}`)
      .eq("custom_url", parsed.value)
      .maybeSingle<RouteUserRow>();

    if (data?.steam_id) {
      const { steam_id: steamId, ...cachedProfileRow } = data;
      const parsedSteamId = parseSteamId64(String(steamId));
      return parsedSteamId ? { steamId: parsedSteamId, cachedProfileRow } : null;
    }
  }

  const steamId = await resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
  return steamId ? { steamId, cachedProfileRow: null } : null;
}

export function cachedSteamProfile(
  row: PlayerProfileDrodoRow | null | undefined,
  options: { requireAvatar: boolean; requireCustomUrl: boolean }
): SteamProfile | null {
  if (!row) return null;

  const profile = {
    name: row.name ?? null,
    customUrl: row.custom_url ?? null,
    avatarUrl: row.avatar_url ?? null,
  };
  const hasProfile = profile.name || profile.customUrl || profile.avatarUrl;
  if (!hasProfile) return null;
  if (options.requireAvatar && !profile.avatarUrl) return null;
  if (options.requireCustomUrl && !profile.customUrl) return null;

  return profile;
}

export function buildPlayerSeo(props: Omit<PlayerPageProps, "route">): {
  title: string;
  description: string;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  imageAlt: string;
  structuredData: Array<Record<string, unknown>>;
} {
  const { steamId, steamProfile, drodo, canonicalUrl, ogImageUrl } = props;

  const displayName = steamProfile.name || steamProfile.customUrl || steamId;
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl);
  const title = `${displayName} | ${SITE_TITLE}`;
  const rankLabel =
    (DRODO_LIVE_FETCH_ENABLED && drodo?.mmr != null
      ? mmrToRank(drodo.mmr)
      : null) ||
    mmrLevelToRank(drodo?.mmr_level) ||
    null;
  const description =
    DRODO_LIVE_FETCH_ENABLED && drodo?.mmr
      ? `${displayName} is ${mmrToRank(drodo.mmr)} at ${drodo.mmr.toLocaleString("en-US")} MMR.`
      : rankLabel
        ? `${displayName} is ${rankLabel}. Live MMR is currently unavailable.`
        : `Dota Auto Chess profile for ${displayName}.`;
  const imageAlt = `${displayName} Auto Chess profile stats`;
  const structuredDataBase = originFromUrl(canonicalUrl);

  const structuredData: Array<Record<string, unknown>> = [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      name: title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      about: {
        "@type": "Person",
        name: displayName,
        sameAs: profileUrl,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Track Auto Chess",
          ...(structuredDataBase ? { item: `${structuredDataBase}/` } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: displayName,
          ...(canonicalUrl ? { item: canonicalUrl } : {}),
        },
      ],
    },
  ];

  return {
    title,
    description,
    canonicalUrl,
    ogImageUrl,
    imageAlt,
    structuredData,
  };
}

export { playerProfilePath };
