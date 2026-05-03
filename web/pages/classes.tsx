import type { SupabaseClient } from "@supabase/supabase-js";
import { BannerAd } from "@/components/BannerAd";
import { EntityBrowser, type BrowsableEntity } from "@/components/EntityBrowser";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getClasses } from "@/lib/synergies";

interface ClassesPageProps {
  supabase: SupabaseClient | null;
}

const ALL_CLASSES: BrowsableEntity[] = getClasses().map((entry) => ({
  slug: entry.slug,
  name: entry.name,
  description: entry.description,
  lore: entry.lore,
  iconSrc: entry.iconUrl,
}));

export default function ClassesPage({ supabase }: ClassesPageProps) {
  const title = `Classes | ${SITE_TITLE}`;
  const description =
    "Browse all Dota Auto Chess class traits like Warrior and Wizard, then open each class detail page.";

  return (
    <>
      <SeoHead title={title} description={description} path="/classes" />
      <EntityBrowser
        title="Classes"
        variant="synergy"
        data={ALL_CLASSES}
        sidebarLeft={<BannerAd slot="sidebar-left" />}
        sidebarRight={<BannerAd slot="sidebar" />}
        topAd={<BannerAd slot="in-content" />}
        bottomAd={<BannerAd slot="in-content-2" />}
      />
    </>
  );
}
