/**
 * Steam profile utilities — server-side only (used in getServerSideProps).
 */

export interface SteamProfile {
  name: string | null;
  customUrl: string | null;
}

/**
 * Fetch a Steam user's display name and custom URL from the community XML API.
 * No API key required.
 */
export async function fetchSteamProfile(
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

/** Build the best Steam community URL for a user. */
export function steamProfileUrl(
  steamId: string,
  customUrl?: string | null
): string {
  if (customUrl) return `https://steamcommunity.com/id/${customUrl}`;
  return `https://steamcommunity.com/profiles/${steamId}`;
}
