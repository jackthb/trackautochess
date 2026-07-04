/**
 * Admin Steam IDs. Admins bypass the manual refresh quota and may refresh any
 * profile. The list is public because the client uses it to decide whether to
 * render the refresh button on other people's profiles.
 */
const ADMIN_STEAM_IDS = new Set(["76561198022169086"]);

export function isAdminSteamId(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return ADMIN_STEAM_IDS.has(String(steamId));
}
