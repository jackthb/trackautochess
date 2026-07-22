"use client";

import { useSessionFlags, type FlagAccess } from "@/lib/sessionFlags";

export type AdminAccess = FlagAccess;

export { normalizeSteamId64 } from "@dac/shared/steam";

/**
 * Client-side admin check via server-evaluated PostHog `admin_access`.
 */
export function useAdminAccess(
  _steamId?: string | null | undefined,
): AdminAccess {
  const { admin } = useSessionFlags();
  return admin;
}

export function useIsAdmin(steamId?: string | null | undefined): boolean {
  return useAdminAccess(steamId) === "enabled";
}
