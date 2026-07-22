import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import { isPostHogFlagEnabledForSteamId } from "@/lib/betaFeaturesServer";

/**
 * Server-side admin check via the PostHog `admin_access` feature flag.
 * Manage membership in PostHog (cohort / person release conditions), not in code.
 */
export async function isAdminSteamId(
  steamId: string | null | undefined,
): Promise<boolean> {
  return isPostHogFlagEnabledForSteamId(steamId, ADMIN_ACCESS_FLAG);
}
