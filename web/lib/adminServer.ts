import {
  ADMIN_ACCESS_FLAG,
  isHardcodedAdminSteamId,
} from "@/lib/adminFlags";
import { isPostHogFlagEnabledForSteamId } from "@/lib/betaFeaturesServer";

/**
 * Server-side admin check: hardcoded owners always pass; everyone else uses
 * PostHog `admin_access`.
 */
export async function isAdminSteamId(
  steamId: string | null | undefined,
): Promise<boolean> {
  if (isHardcodedAdminSteamId(steamId)) return true;
  return isPostHogFlagEnabledForSteamId(steamId, ADMIN_ACCESS_FLAG);
}
