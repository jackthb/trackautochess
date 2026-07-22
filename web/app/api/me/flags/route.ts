import { toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/adminServer";
import { isBetaFeaturesEnabledForSteamId } from "@/lib/betaFeaturesServer";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";

/**
 * Session feature flags for nav/gates. Evaluated server-side so ad blockers /
 * cookieless PostHog clients can't hide Builds/Guides/Matches/CMS forever.
 */
export async function GET(req: Request) {
  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!session.steamId) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const [adminAccess, betaFeatures] = await Promise.all([
    isAdminSteamId(session.steamId),
    isBetaFeaturesEnabledForSteamId(session.steamId),
  ]);

  return Response.json({
    steamId: session.steamId,
    admin_access: adminAccess,
    website_beta_features: betaFeatures,
  });
}
