/**
 * Steam profile utilities — server-side only (used in getServerSideProps).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SteamProfile {
  name: string | null;
  customUrl: string | null;
}

/**
 * Fetch a Steam user's display name and custom URL from the community XML API.
 * No API key required.
 */
export async function fetchSteamProfileFromApi(
  steamId: string
): Promise<SteamProfile> {
  try {
    const resp = await fetch(
      `https://steamcommunity.com/profiles/${steamId}/?xml=1`
    );
    const xml = await resp.text();
    const nameMatch = xml.match(
      /<steamID><!\[CDATA\[(.+?)\]\]><\/steamID>/
    );
    const customUrlMatch = xml.match(
      /<customURL><!\[CDATA\[(.+?)\]\]><\/customURL>/
    );
    return {
      name: nameMatch ? nameMatch[1] : null,
      customUrl: customUrlMatch ? customUrlMatch[1] : null,
    };
  } catch {
    return { name: null, customUrl: null };
  }
}

/**
 * Resolve a Steam profile: check the users table first, then fall back to the
 * Steam API and cache the result in the DB for next time.
 */
export async function fetchSteamProfile(
  steamId: string,
  supabase?: SupabaseClient
): Promise<SteamProfile> {
  // 1. Try the DB first
  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("name, custom_url")
      .eq("steam_id", steamId)
      .single();

    if (data?.name) {
      return { name: data.name, customUrl: data.custom_url ?? null };
    }
  }

  // 2. Fall back to Steam API
  const profile = await fetchSteamProfileFromApi(steamId);

  // 3. Cache the result in the DB (best-effort, don't block on failure)
  if (supabase && profile.name) {
    supabase
      .from("users")
      .update({ name: profile.name, custom_url: profile.customUrl })
      .eq("steam_id", steamId)
      .then(() => {});
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
