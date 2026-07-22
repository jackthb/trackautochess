import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import { isPostHogFlagEnabledForSteamId } from "@/lib/betaFeaturesServer";

/** Server-side admin check via PostHog `admin_access`. */
export async function isAdminSteamId(
  steamId: string | null | undefined,
): Promise<boolean> {
  return isPostHogFlagEnabledForSteamId(steamId, ADMIN_ACCESS_FLAG);
}
