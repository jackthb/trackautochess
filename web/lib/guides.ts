import { guideIndexData, guidesBySlugData } from "@/generated/content-data";

export interface DisplayGuide {
  slug: string;
  title: string;
  body: string;
  shareLink: string | null;
}

interface GuideRecord {
  body?: string;
  shareLink?: string;
}

const GUIDE_INDEX = (
  guideIndexData as { guides: { slug: string; title: string }[] }
).guides;

const GUIDES_BY_SLUG = guidesBySlugData as Record<string, GuideRecord | undefined>;

export function getAllGuides(): DisplayGuide[] {
  return GUIDE_INDEX.map((guide) => {
    const record = GUIDES_BY_SLUG[guide.slug];
    return {
      slug: guide.slug,
      title: guide.title,
      body: record?.body?.trim() ?? "",
      shareLink: record?.shareLink?.trim() || null,
    };
  });
}
