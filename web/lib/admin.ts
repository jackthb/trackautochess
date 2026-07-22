import { isSteamId64 } from "@dac/shared/steam";

/**
 * Admin Steam IDs. Admins bypass the manual refresh quota and may refresh any
 * profile. The list is public because the client uses it to decide whether to
 * render the refresh button on other people's profiles.
 */
const ADMIN_STEAM_IDS = new Set(["76561198022169086"]);

/** Normalize session/metadata steam ids without Number() (ID64s exceed safe int). */
export function normalizeSteamId64(
  value: unknown,
): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return isSteamId64(trimmed) ? trimmed : null;
  }
  // Reject numbers — Steam ID64s are not safe as JS numbers.
  return null;
}

export function isAdminSteamId(steamId: string | null | undefined): boolean {
  const normalized = normalizeSteamId64(steamId);
  if (!normalized) return false;
  return ADMIN_STEAM_IDS.has(normalized);
}
