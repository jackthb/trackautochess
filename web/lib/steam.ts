/**
 * Steam profile utilities used by the web app.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SteamProfile {
  name: string | null;
  customUrl: string | null;
  avatarUrl?: string | null;
}

export interface ParsedSteamInput {
  kind: "id" | "slug";
  value: string;
}

interface SteamLookupOptions {
  persist?: boolean;
}

interface SteamApiProfile extends SteamProfile {
  steamId: string | null;
}

interface SteamVanityResponse {
  response?: {
    success?: number;
    steamid?: string;
  };
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
    steamId: steamIdMatch ? steamIdMatch[1] : null,
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
        "User-Agent": "track.autochess profile resolver",
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
      return { ...profile, steamId: canonicalProfile[1] };
    }

    return profile;
  } catch {
    return { steamId: null, name: null, customUrl: null };
  }
}

async function resolveSteamVanityWithApi(slug: string): Promise<string | null> {
  const key = process.env.STEAM_WEB_API_KEY || process.env.STEAM_API_KEY;
  if (!key) return null;

  try {
    const params = new URLSearchParams({
      key,
      vanityurl: slug,
      url_type: "1",
    });
    const resp = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?${params}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "track.autochess profile resolver",
        },
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as SteamVanityResponse;
    return data.response?.success === 1 && data.response.steamid
      ? data.response.steamid
      : null;
  } catch {
    return null;
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
  if (profileMatch) return { kind: "id", value: profileMatch[1] };

  const customUrlMatch = decoded.match(
    /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/id\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/i
  );
  if (customUrlMatch) return { kind: "slug", value: customUrlMatch[1] };

  if (/^\d+$/.test(decoded)) return { kind: "id", value: decoded };
  if (/^[A-Za-z0-9_-]+$/.test(decoded)) {
    return { kind: "slug", value: decoded };
  }

  return null;
}

export async function upsertSteamUser(
  steamId: string,
  supabase?: SupabaseClient,
  profile?: SteamProfile | null
): Promise<void> {
  if (!supabase || !steamId) return;

  const payload: {
    steam_id: string;
    name?: string;
    custom_url?: string;
  } = { steam_id: steamId };

  if (profile?.name) payload.name = profile.name;
  if (profile?.customUrl) payload.custom_url = profile.customUrl;

  await supabase.from("users").upsert(payload, { onConflict: "steam_id" });
}

/**
 * Fetch a Steam user's display name and custom URL from the community XML API.
 * No API key required.
 */
export async function fetchSteamProfileFromApi(
  steamId: string
): Promise<SteamProfile> {
  const profile = await fetchSteamProfileXml(
    `https://steamcommunity.com/profiles/${steamId}/?xml=1`
  );
  return {
    name: profile.name,
    customUrl: profile.customUrl,
    avatarUrl: profile.avatarUrl,
  };
}

/**
 * Resolve a Steam profile: check the users table first, then fall back to the
 * Steam API and cache the result in the DB for next time.
 */
export async function fetchSteamProfile(
  steamId: string,
  supabase?: SupabaseClient,
  options: SteamLookupOptions = {}
): Promise<SteamProfile> {
  let cachedProfile: SteamProfile | null = null;

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("name, custom_url")
      .eq("steam_id", steamId)
      .maybeSingle();

    if (data) {
      cachedProfile = {
        name: data.name ?? null,
        customUrl: data.custom_url ?? null,
      };
      if (cachedProfile.name && cachedProfile.customUrl) {
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

/**
 * Resolve a vanity URL slug (e.g. "agit142" from steamcommunity.com/id/agit142)
 * to a numeric SteamID64. Checks the local users table first, then falls back
 * to Steam's public XML profile endpoint.
 */
export async function resolveSteamId(
  slug: string,
  supabase?: SupabaseClient,
  options: SteamLookupOptions = {}
): Promise<string | null> {
  const parsed = parseSteamInput(slug);
  if (!parsed) return null;
  if (parsed.kind === "id") return parsed.value;

  const clean = parsed.value;

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("steam_id")
      .or(`custom_url.ilike.${clean},name.ilike.${clean}`)
      .maybeSingle();
    if (data?.steam_id) return String(data.steam_id);
  }

  const apiSteamId = await resolveSteamVanityWithApi(clean);
  if (apiSteamId) {
    if (options.persist !== false) {
      const apiProfile = await fetchSteamProfileFromApi(apiSteamId);
      await upsertSteamUser(apiSteamId, supabase, {
        name: apiProfile.name,
        customUrl: apiProfile.customUrl ?? clean,
      });
    }
    return apiSteamId;
  }

  const profile = await fetchSteamProfileXml(
    `https://steamcommunity.com/id/${encodeURIComponent(clean)}/?xml=1`
  );
  if (!profile.steamId) return null;

  if (options.persist !== false) {
    await upsertSteamUser(profile.steamId, supabase, {
      name: profile.name,
      customUrl: profile.customUrl ?? clean,
    });
  }

  return profile.steamId;
}

export async function resolveSteamInput(
  raw: string,
  supabase?: SupabaseClient,
  options: SteamLookupOptions = {}
): Promise<string | null> {
  const parsed = parseSteamInput(raw);
  if (!parsed) return null;
  if (parsed.kind === "id") return parsed.value;
  return resolveSteamId(parsed.value, supabase, options);
}
