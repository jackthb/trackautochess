import { toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/adminServer";
import { linkifyGuideBody } from "@/lib/guideLinks";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";
import { guidesBySlugData } from "@/generated/content-data";

interface Props {
  params: Promise<{ slug: string }>;
}

/** Admin-only single guide. Not public — see AdminGate on /guides/[slug]. */
export async function GET(req: Request, { params }: Props) {
  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!(await isAdminSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const guide = (guidesBySlugData as Record<string, { body?: string } | undefined>)[slug];
  if (!guide) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const linked =
    typeof guide.body === "string" ? { ...guide, body: linkifyGuideBody(guide.body) } : guide;

  return Response.json({ guide: linked });
}
