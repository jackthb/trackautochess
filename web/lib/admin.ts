"use client";

import { isSteamId64 } from "@dac/shared/steam";
import { useSessionFlags, type FlagAccess } from "@/lib/sessionFlags";

export type AdminAccess = FlagAccess;

/** Normalize session/metadata steam ids without Number() (ID64s exceed safe int). */
export function normalizeSteamId64(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return isSteamId64(trimmed) ? trimmed : null;
  }
  return null;
}

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
