import { requireAdminSession } from "@/lib/adminServer";
import { getGuidePreviewIcons, type GuidePreviewIcon } from "@/lib/guidePreviewIcons";
import { guidesBySlugData, guideIndexData } from "@/generated/content-data";

interface IndexGuide {
  slug: string;
  title: string;
  icons: GuidePreviewIcon[];
}

/** Admin-gated guide index. */
export async function GET(req: Request) {
  const gate = await requireAdminSession(req);
  if (!gate.ok) return gate.response;

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
