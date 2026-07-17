/**
 * Admin Steam IDs for desktop-only tooling (outbox flush, legendary overlay).
 * Mirrors web/lib/admin.ts.
 */
const ADMIN_STEAM_IDS = new Set(["76561198022169086"]);

export function isAdminSteamId(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return ADMIN_STEAM_IDS.has(String(steamId));
}
