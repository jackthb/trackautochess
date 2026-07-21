"use client";

import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import {
  usePostHogFlagAccess,
  type BetaFeatureAccess,
} from "@/lib/betaFeatures";

export type AdminAccess = BetaFeatureAccess;

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
