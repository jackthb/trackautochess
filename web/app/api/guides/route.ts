import { toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/admin";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";
import { guideIndexData } from "@/generated/content-data";

interface IndexGuide {
  slug: string;
  title: string;
}

/** Admin-only guide index. Not public — see AdminGate on /guides. */
export async function GET(req: Request) {
  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!isAdminSteamId(session.steamId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const guides = (guideIndexData as { guides: IndexGuide[] }).guides;
  return Response.json({ guides });
}
