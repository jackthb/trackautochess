/**
 * Steam profile utilities used by the web app.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSteamId64,
  parseSteamId64,
  type SteamId64,
} from "@dac/shared/steam";

export interface SteamProfile {
  name: string | null;
  customUrl: string | null;
  avatarUrl?: string | null;
}

export type ParsedSteamInput =
  | { kind: "id"; value: SteamId64 }
  | { kind: "slug"; value: string };

export const isValidSteamId64 = isSteamId64;

interface SteamLookupOptions {
  persist?: boolean;
  force?: boolean;
  requireAvatar?: boolean;
  requireCustomUrl?: boolean;
  maxAgeMs?: number;
}

interface SteamApiProfile extends SteamProfile {
  steamId: SteamId64 | null;
}

interface SteamWebApiPlayer {
  steamid?: string;
  personaname?: string;
  profileurl?: string;
  avatarfull?: string;
  avatarmedium?: string;
}

function parseSteamProfileXml(xml: string): SteamApiProfile {
  const steamIdMatch = xml.match(/<steamID64>(\d+)<\/steamID64>/);
  const nameMatch = xml.match(/<steamID><!\[CDATA\[(.+?)\]\]><\/steamID>/);
  const customUrlMatch = xml.match(
    /<customURL><!\[CDATA\[(.+?)\]\]><\/customURL>/
  );
  const avatarFullMatch = xml.match(
    /<avatarFull><!\[CDATA\[(.+?)\]\]><\/avatarFull>/
  );
  const avatarMediumMatch = xml.match(
    /<avatarMedium><!\[CDATA\[(.+?)\]\]><\/avatarMedium>/
  );

  return {
    steamId: steamIdMatch ? parseSteamId64(steamIdMatch[1]) : null,
    name: nameMatch ? nameMatch[1] : null,
    customUrl: customUrlMatch ? customUrlMatch[1] : null,
    avatarUrl: avatarFullMatch?.[1] ?? avatarMediumMatch?.[1] ?? null,
  };
}

async function fetchSteamProfileXml(url: string): Promise<SteamApiProfile> {
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
        "User-Agent": "Track Auto Chess profile resolver",
      },
      redirect: "follow",
    });
    if (!resp.ok) {
      return { steamId: null, name: null, customUrl: null };
    }
    const xml = await resp.text();
    const profile = parseSteamProfileXml(xml);
    if (profile.steamId) return profile;

    const canonicalProfile = resp.url.match(
      /steamcommunity\.com\/profiles\/(\d+)/i
    );
    if (canonicalProfile) {
      return { ...profile, steamId: parseSteamId64(canonicalProfile[1]) };
    }

    return profile;
  } catch {
    return { steamId: null, name: null, customUrl: null };
  }
}

export function parseSteamInput(raw: string): ParsedSteamInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }

  const profileMatch = decoded.match(
    /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/profiles\/(\d+)(?:[/?#].*)?$/i
  );
  if (profileMatch) {
    const steamId = parseSteamId64(profileMatch[1]);
    return steamId ? { kind: "id", value: steamId } : null;
  }

  const customUrlMatch = decoded.match(
    /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/id\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/i
  );
  if (customUrlMatch) return { kind: "slug", value: customUrlMatch[1] };

  if (/^\d+$/.test(decoded)) {
    const steamId = parseSteamId64(decoded);
    return steamId ? { kind: "id", value: steamId } : null;
  }
  if (/^[A-Za-z0-9_-]+$/.test(decoded)) {
    return { kind: "slug", value: decoded };
  }

  return null;
}

export async function upsertSteamUser(
  steamId: SteamId64,
  supabase?: SupabaseClient,
  profile?: (SteamProfile & { steamSignedInAt?: string }) | null
): Promise<void> {
  if (!supabase || !isValidSteamId64(steamId)) return;

  const payload: {
    steam_id: string;
    name?: string;
    custom_url?: string;
    avatar_url?: string;
    steam_signed_in_at?: string;
  } = { steam_id: steamId };

  if (profile?.name) payload.name = profile.name;
  if (profile?.customUrl) payload.custom_url = profile.customUrl;
  if (profile?.avatarUrl) payload.avatar_url = profile.avatarUrl;
  if (profile?.steamSignedInAt) payload.steam_signed_in_at = profile.steamSignedInAt;

  const { error } = await supabase
    .from("users")
    .upsert(payload, { onConflict: "steam_id" });

  if (error && payload.avatar_url) {
    const { avatar_url, ...withoutAvatar } = payload;
    await supabase.from("users").upsert(withoutAvatar, {
      onConflict: "steam_id",
    });
  }
}

/**
 * Fetch a Steam user's display name and custom URL from the community XML API.
 * No API key required.
 */
export async function fetchSteamProfileFromApi(
  steamId: SteamId64
): Promise<SteamProfile> {
  const xmlProfile = await fetchSteamProfileXml(
    `https://steamcommunity.com/profiles/${steamId}/?xml=1`
  );
  const webApiProfile =
    !xmlProfile.name || !xmlProfile.avatarUrl
      ? await fetchSteamProfileFromWebApi(steamId)
      : null;

  return {
    name: xmlProfile.name ?? webApiProfile?.name ?? null,
    customUrl: xmlProfile.customUrl ?? webApiProfile?.customUrl ?? null,
    avatarUrl: xmlProfile.avatarUrl ?? webApiProfile?.avatarUrl ?? null,
  };
}

async function fetchSteamProfileFromWebApi(
  steamId: SteamId64
): Promise<SteamProfile | null> {
  const key = process.env.STEAM_WEB_API_KEY?.trim();
  if (!key) return null;

  try {
    const resp = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(
        key
      )}&steamids=${steamId}`,
      {
        headers: {
          "User-Agent": "Track Auto Chess profile resolver",
        },
      }
    );
    if (!resp.ok) return null;
    const payload = (await resp.json()) as {
      response?: { players?: SteamWebApiPlayer[] };
    };
    const player = payload.response?.players?.[0];
    if (!player) return null;

    const customUrl = player.profileurl?.match(
      /steamcommunity\.com\/id\/([^/?#]+)/i
    )?.[1];
    return {
      name: player.personaname?.trim() || null,
      customUrl: customUrl ? decodeURIComponent(customUrl) : null,
      avatarUrl: player.avatarfull ?? player.avatarmedium ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a Steam profile: check the users table first, then fall back to the
 * Steam API and cache the result in the DB for next time.
 */
export async function fetchSteamProfile(
  steamId: SteamId64,
  supabase?: SupabaseClient,
  options: SteamLookupOptions = {}
): Promise<SteamProfile> {
  let cachedProfile: SteamProfile | null = null;

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("name, custom_url, avatar_url")
      .filter("steam_id", "eq", steamId)
      .maybeSingle();

    if (data) {
      cachedProfile = {
        name: data.name ?? null,
        customUrl: data.custom_url ?? null,
        avatarUrl: data.avatar_url ?? null,
      };
      const hasCachedProfile =
        cachedProfile.name || cachedProfile.customUrl || cachedProfile.avatarUrl;
      if (
        !options.force &&
        hasCachedProfile &&
        (!options.requireAvatar || cachedProfile.avatarUrl) &&
        (!options.requireCustomUrl || cachedProfile.customUrl)
      ) {
        return cachedProfile;
      }
    }
  }

  const apiProfile = await fetchSteamProfileFromApi(steamId);
  const profile = {
    name: apiProfile.name ?? cachedProfile?.name ?? null,
    customUrl: apiProfile.customUrl ?? cachedProfile?.customUrl ?? null,
    avatarUrl: apiProfile.avatarUrl ?? cachedProfile?.avatarUrl ?? null,
  };

  if (options.persist !== false) {
    await upsertSteamUser(steamId, supabase, profile);
  }
  return profile;
}

/** Build the best Steam community URL for a user. */
export function steamProfileUrl(
  steamId: string,
  customUrl?: string | null
): string {
  if (customUrl) return `https://steamcommunity.com/id/${customUrl}`;
  return `https://steamcommunity.com/profiles/${steamId}`;
}

/** Build the public Track Auto Chess player route, preferring vanity URLs. */
export function playerProfilePath(
  steamId: string,
  customUrl?: string | null
): string {
  const cleanCustomUrl = customUrl?.trim();
  // Numeric path segments are parsed as SteamID64s by /players/[steamId].
  // Short numeric vanity-looking values such as Douyu room ids would become
  // permanent 404 links, so fall back to the real SteamID64 for those rows.
  const routeId =
    cleanCustomUrl && !/^\d+$/.test(cleanCustomUrl) ? cleanCustomUrl : steamId;
  return `/players/${encodeURIComponent(routeId)}`;
}

/**
 * Stored avatar URLs are the 184×184 `_full.jpg` variant, but list rows render
 * at 28–32px, where the 64×64 `_medium.jpg` variant is sharp even at 2× DPR at
 * a fraction of the bytes. Steam serves the same hash path from the legacy
 * avatars.{akamai,fastly}.steamstatic.com hosts and the canonical
 * avatars.steamstatic.com; normalizing to the canonical host lets a page of
 * avatars share one connection (and the layout's existing preconnect).
 */
export function listAvatarUrl(url: string): string {
  return url
    .replace(
      /^https:\/\/avatars\.(?:akamai|fastly)\.steamstatic\.com\//,
      "https://avatars.steamstatic.com/"
    )
    .replace(/_full(\.[a-z]+)$/, "_medium$1");
}

/**
 * Resolve a vanity URL slug (e.g. "example-player" from steamcommunity.com/id/example-player)
 * to a numeric SteamID64. Steam is the authority for vanity URLs; cached
 * custom_url rows can go stale when users rename or transfer vanity slugs.
 */
export async function resolveSteamId(
  slug: string,
  supabase?: SupabaseClient,
  options: SteamLookupOptions = {}
): Promise<SteamId64 | null> {
  const parsed = parseSteamInput(slug);
  if (!parsed) return null;
  if (parsed.kind === "id") return parsed.value;

  const clean = parsed.value;

  const profile = await fetchSteamProfileXml(
    `https://steamcommunity.com/id/${encodeURIComponent(clean)}/?xml=1`
  );
  if (!profile.steamId) return null;

  if (options.persist !== false) {
    await upsertSteamUser(profile.steamId, supabase, {
      name: profile.name,
      customUrl: profile.customUrl ?? clean,
      avatarUrl: profile.avatarUrl,
    });
  }

  return profile.steamId;
}

export async function resolveSteamInput(
  raw: string,
  supabase?: SupabaseClient,
  options: SteamLookupOptions = {}
): Promise<SteamId64 | null> {
  const parsed = parseSteamInput(raw);
  if (!parsed) return null;
  if (parsed.kind === "id") return parsed.value;
  return resolveSteamId(parsed.value, supabase, options);
}
