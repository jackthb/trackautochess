import type { SupabaseClient } from "@supabase/supabase-js";
import { toApiReq } from "@/lib/abuseLog";
import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import { isPostHogFlagEnabledForSteamId } from "@/lib/betaFeaturesServer";
import { getSessionUser, type SessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";

/** Server-side admin check via PostHog `admin_access`. */
export async function isAdminSteamId(
  steamId: string | null | undefined,
): Promise<boolean> {
  return isPostHogFlagEnabledForSteamId(steamId, ADMIN_ACCESS_FLAG);
}

/** Either a denial to return as-is, or the resolved admin caller. */
export type AdminGate =
  | { ok: false; response: Response }
  | { ok: true; session: SessionUser; anon: SupabaseClient | null };

/**
 * Shared admin preamble for the API routes that gate on `admin_access` alone.
 *
 * Four handlers opened with the same three steps — build the anon client,
 * resolve the session from the bearer token, reject non-admins with a 403 —
 * and each kept its own copy of the denial body. Sharing it here means a change
 * to how routes identify an admin lands everywhere at once, and `/api/builds`
 * (which needs the sign-in and steam-id plumbing on top) can keep its richer
 * `openBuildRoute` gate without the two drifting on the admin check itself.
 *
 * `anon` is handed back because callers that read public tables reuse the same
 * client for their query rather than building a second one.
 */
export async function requireAdminSession(req: Request): Promise<AdminGate> {
  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!(await isAdminSteamId(session.steamId))) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, session, anon };
}
