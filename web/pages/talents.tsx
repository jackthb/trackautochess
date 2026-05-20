import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/router";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllTalents, getTierLabel, type DisplayTalent } from "@/lib/talents";
import { normalizeLocale } from "@/lib/i18n";
import browserStyles from "@/components/EntityBrowser.module.css";
import cardStyles from "@/components/EntityCard.module.css";
import { PageLayout } from "@/components/PageLayout";

interface TalentsPageProps {
  supabase: SupabaseClient | null;
}

const t = {
  title: `Talents | ${SITE_TITLE}`,
  description:
    "Browse all Dota Auto Chess talent choices by round, compare branch A/B effects, and quickly cross-reference patch notes updates.",
  heading: "Talents",
  structuredName: "Dota Auto Chess talents",
  structuredAbout: "Dota Auto Chess talents",
};

export default function TalentsPage({ supabase }: TalentsPageProps) {
  void supabase;
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);

  const talents = getAllTalents(locale);

  const tiers = new Map<number, DisplayTalent[]>();
  for (const tt of talents) {
    if (!tiers.has(tt.tier)) tiers.set(tt.tier, []);
    tiers.get(tt.tier)!.push(tt);
  }
  const tierRows = [...tiers.entries()].sort(([a], [b]) => a - b);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t.structuredName,
    description: t.description,
    about: t.structuredAbout,
  };

  return (
    <>
      <SeoHead title={t.title} description={t.description} path="/talents" locale={locale} structuredData={structuredData} />
      <PageLayout title={t.heading}>
        {tierRows.map(([tier, entries]) => (
          <section key={tier} className={browserStyles.panel}>
            <div className={browserStyles.panelHeader}>
              <span>{getTierLabel(tier)}</span>
              <span className={browserStyles.count}>{entries.length}</span>
            </div>
            <div className={`${browserStyles.grid} ${browserStyles.gridRelic}`}>
              {entries.map((tt) => (
                <div
                  key={tt.key}
                  className={`${cardStyles.card} ${cardStyles.relic}`}
                  style={{ cursor: "default" }}
                >
                  <div className={cardStyles.body}>
                    <div className={cardStyles.name}>{tt.name}</div>
                    <div className={cardStyles.desc}>{tt.description}</div>
                  </div>
                  <div className={cardStyles.level}>{tt.branch}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </PageLayout>
    </>
  );
}
