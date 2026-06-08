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

// BigInt(...) instead of n-literals so the ES2017 tsconfig target accepts them.
const STEAM_ID64_MIN = BigInt("76561197960265728");
const STEAM_ID64_MAX = BigInt("76561202255233023");

export function isValidSteamId64(input: string): boolean {
  if (!/^\d+$/.test(input)) return false;
  try {
    const value = BigInt(input);
    return value >= STEAM_ID64_MIN && value <= STEAM_ID64_MAX;
  } catch {
    return false;
  }
}

interface SteamLookupOptions {
  persist?: boolean;
  requireAvatar?: boolean;
  requireCustomUrl?: boolean;
}

interface SteamApiProfile extends SteamProfile {
  steamId: string | null;
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
      return { ...profile, steamId: canonicalProfile[1] };
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
    return isValidSteamId64(profileMatch[1])
      ? { kind: "id", value: profileMatch[1] }
      : null;
  }

  const customUrlMatch = decoded.match(
    /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/id\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/i
  );
  if (customUrlMatch) return { kind: "slug", value: customUrlMatch[1] };

  if (/^\d+$/.test(decoded)) {
    return isValidSteamId64(decoded) ? { kind: "id", value: decoded } : null;
  }
  if (/^[A-Za-z0-9_-]+$/.test(decoded)) {
    return { kind: "slug", value: decoded };
  }

  return null;
}

export async function upsertSteamUser(
  steamId: string,
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
  steamId: string
): Promise<SteamProfile> {
  if (!isValidSteamId64(steamId)) {
    return { name: null, customUrl: null, avatarUrl: null };
  }
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
  if (!isValidSteamId64(steamId)) {
    return { name: null, customUrl: null, avatarUrl: null };
  }

  let cachedProfile: SteamProfile | null = null;

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("name, custom_url, avatar_url")
      .eq("steam_id", steamId)
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
  return `/players/${encodeURIComponent(customUrl || steamId)}`;
}

/**
 * Resolve a vanity URL slug (e.g. "agit142" from steamcommunity.com/id/agit142)
 * to a numeric SteamID64. Steam is the authority for vanity URLs; cached
 * custom_url rows can go stale when users rename or transfer vanity slugs.
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

  const profile = await fetchSteamProfileXml(
    `https://steamcommunity.com/id/${encodeURIComponent(clean)}/?xml=1`
  );
  if (!profile.steamId || !isValidSteamId64(profile.steamId)) return null;

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
): Promise<string | null> {
  const parsed = parseSteamInput(raw);
  if (!parsed) return null;
  if (parsed.kind === "id") return parsed.value;
  return resolveSteamId(parsed.value, supabase, options);
}
