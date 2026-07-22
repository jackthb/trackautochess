import { toApiReq } from "@/lib/abuseLog";
import { isBetaFeaturesEnabledForSteamId } from "@/lib/betaFeaturesServer";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";
import { guideIndexData } from "@/generated/content-data";

interface IndexGuide {
  slug: string;
  title: string;
}

/** Beta-flagged guide index. Admins bypass via isBetaFeaturesEnabledForSteamId. */
export async function GET(req: Request) {
  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!(await isBetaFeaturesEnabledForSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const guides = (guideIndexData as { guides: IndexGuide[] }).guides;
  return Response.json({ guides });
}
