import { toApiReq } from "@/lib/abuseLog";
import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import { probePostHogFlagForSteamId } from "@/lib/betaFeaturesServer";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";

/**
 * Session feature flags for nav/gates. Evaluated server-side so ad blockers /
 * cookieless PostHog clients can't hide gated pages forever.
 */
export async function GET(req: Request) {
  const anon = createSupabaseAnonClient();
  if (!anon) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }
  const session = await getSessionUser(toApiReq(req), anon);
  if (!session.steamId) {
    return Response.json(
      {
        error: "Sign in required",
        hint: "Session has no steam_id — sign out and back in through Steam.",
      },
      { status: 401 },
    );
  }

  const probe = await probePostHogFlagForSteamId(
    session.steamId,
    ADMIN_ACCESS_FLAG,
  );

  if (process.env.NODE_ENV === "development") {
    console.info("[flags]", {
      steamId: session.steamId,
      admin_access: probe.enabled,
      host: probe.host,
      hasToken: probe.hasToken,
      httpStatus: probe.httpStatus,
      flagPresent: probe.flagPresent,
      raw: probe.raw,
      error: probe.error,
    });
  }

  return Response.json({
    steamId: session.steamId,
    admin_access: probe.enabled,
    ...(process.env.NODE_ENV === "development"
      ? {
          debug: {
            flag: ADMIN_ACCESS_FLAG,
            host: probe.host,
            hasToken: probe.hasToken,
            httpStatus: probe.httpStatus,
            flagPresent: probe.flagPresent,
            raw: probe.raw,
            error: probe.error,
          },
        }
      : {}),
  });
}
