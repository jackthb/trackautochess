import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE_TITLE } from "@/lib/site";
import { mmrToRank } from "@dac/shared/game-utils";
import {
  parseSteamInput,
  playerProfilePath,
  resolveSteamInput,
  steamProfileUrl,
  type SteamProfile,
} from "@/lib/steam";
import type { PlayerPageProps } from "./PlayerView";

export const USER_DRODO_SELECT = [
  "name",
  "custom_url",
  "avatar_url",
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_mmr_level",
  "drodo_season",
  "drodo_season_games",
  "drodo_candy",
  "drodo_chicken_count",
  "drodo_last_fetched_at",
  "drodo_profile_missing",
].join(", ");

export interface CachedUserDrodoRow {
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number | null;
  drodo_last_fetched_at: string | null;
  drodo_profile_missing: boolean | null;
}

interface RouteUserRow extends CachedUserDrodoRow {
  steam_id: string;
}

export interface ResolvedPlayerRoute {
  steamId: string;
  cachedProfileRow: CachedUserDrodoRow | null;
}

function originFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export async function resolvePlayerRoute(
  rawSteamId: string,
  supabase: SupabaseClient | null
): Promise<ResolvedPlayerRoute | null> {
  const parsed = parseSteamInput(rawSteamId);
  if (!parsed) return null;
  if (parsed.kind === "id") {
    return { steamId: parsed.value, cachedProfileRow: null };
  }

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select(`steam_id::text, ${USER_DRODO_SELECT}`)
      .eq("custom_url", parsed.value)
      .maybeSingle<RouteUserRow>();

    if (data?.steam_id) {
      const { steam_id: steamId, ...cachedProfileRow } = data;
      return { steamId: String(steamId), cachedProfileRow };
    }
  }

  const steamId = await resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
  return steamId ? { steamId, cachedProfileRow: null } : null;
}

export function cachedSteamProfile(
  row: CachedUserDrodoRow | null | undefined,
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
  const description = drodo?.mmr
    ? `${displayName} is ${mmrToRank(drodo.mmr)} at ${drodo.mmr.toLocaleString("en-US")} MMR.`
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
