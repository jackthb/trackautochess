import { toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/adminServer";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";
import { getGuidePreviewIcons, type GuidePreviewIcon } from "@/lib/guidePreviewIcons";
import { guidesBySlugData, guideIndexData } from "@/generated/content-data";

interface IndexGuide {
  slug: string;
  title: string;
  icons: GuidePreviewIcon[];
}

/** Admin-gated guide index. */
export async function GET(req: Request) {
  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!(await isAdminSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const guidesBySlug = guidesBySlugData as Record<
    string,
    { shareLink?: string | null }
  >;
  const guides = (guideIndexData as { guides: { slug: string; title: string }[] }).guides.map(
    (guide) => ({
      slug: guide.slug,
      title: guide.title,
      icons: getGuidePreviewIcons(
        guide.slug,
        guide.title,
        guidesBySlug[guide.slug]?.shareLink,
      ),
    }),
  );
  return Response.json({ guides });
}
