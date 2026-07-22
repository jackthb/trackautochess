"use client";

import { isSteamId64 } from "@dac/shared/steam";
import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import {
  usePostHogFlagAccess,
  type BetaFeatureAccess,
} from "@/lib/betaFeatures";

export type AdminAccess = BetaFeatureAccess;

/** Normalize session/metadata steam ids without Number() (ID64s exceed safe int). */
export function normalizeSteamId64(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return isSteamId64(trimmed) ? trimmed : null;
  }
  return null;
}

/**
 * Client-side admin check via the PostHog `admin_access` feature flag.
 * Manage membership in PostHog (cohort / person release conditions), not in code.
 */
export function useAdminAccess(
  steamId: string | null | undefined,
): AdminAccess {
  return usePostHogFlagAccess(ADMIN_ACCESS_FLAG, steamId);
}

export function useIsAdmin(steamId: string | null | undefined): boolean {
  return useAdminAccess(steamId) === "enabled";
}
