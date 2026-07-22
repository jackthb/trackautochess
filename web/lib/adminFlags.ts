// Shared with the desktop app: both identify people by steam_id in the same
// PostHog project, so one boolean flag controls admin UI + API access.
export const ADMIN_ACCESS_FLAG = "admin_access";

/**
 * Always-on admin Steam IDs. PostHog `admin_access` can still grant others;
 * this list is the failsafe when flags API/token/proxy misbehave.
 */
export const HARDCODED_ADMIN_STEAM_IDS = ["76561198022169086"] as const;

export function isHardcodedAdminSteamId(
  steamId: string | null | undefined,
): boolean {
  if (!steamId) return false;
  return (HARDCODED_ADMIN_STEAM_IDS as readonly string[]).includes(steamId);
}
