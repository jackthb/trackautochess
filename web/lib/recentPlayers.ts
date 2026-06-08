// Recently-viewed players, persisted in localStorage so a returning visitor
// can one-click back to their own profile without retyping a Steam ID/vanity.

export interface RecentPlayer {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
}

const KEY = "dac:recent-players";
const MAX = 4;

function isRecentPlayer(value: unknown): value is RecentPlayer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.steam_id === "string" && row.steam_id.length > 0;
}

export function getRecentPlayers(): RecentPlayer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentPlayer).slice(0, MAX);
  } catch {
    return [];
  }
}

/** Prepend a player (de-duped by steam_id), cap the list, persist, and return it. */
export function addRecentPlayer(player: RecentPlayer): RecentPlayer[] {
  if (typeof window === "undefined" || !player.steam_id) {
    return getRecentPlayers();
  }
  const entry: RecentPlayer = {
    steam_id: player.steam_id,
    name: player.name ?? null,
    custom_url: player.custom_url ?? null,
  };
  const next = [
    entry,
    ...getRecentPlayers().filter((row) => row.steam_id !== entry.steam_id),
  ].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore quota / disabled-storage errors — recents are best-effort.
  }
  return next;
}
