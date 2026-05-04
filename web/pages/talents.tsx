import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/router";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllTalents, getTierLabel, type DisplayTalent } from "@/lib/talents";
import { normalizeLocale } from "@/lib/i18n";
import browserStyles from "@/components/EntityBrowser.module.css";
import cardStyles from "@/components/EntityCard.module.css";

interface TalentsPageProps {
  supabase: SupabaseClient | null;
}

const T = {
  en: {
    title: `Talents | ${SITE_TITLE}`,
    description:
      "Browse all Dota Auto Chess talent choices by round, compare branch A/B effects, and quickly cross-reference patch notes updates.",
    heading: "Talents",
  },
  ru: {
    title: `Таланты | ${SITE_TITLE}`,
    description:
      "Все таланты Dota Auto Chess по раундам — сравнивайте эффекты ветвей A/B и быстро сверяйтесь с патчноутами.",
    heading: "Таланты",
  },
} as const;

export default function TalentsPage({ supabase }: TalentsPageProps) {
  void supabase;
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);
  const t = T[locale];

  const talents = getAllTalents();

  const tiers = new Map<number, DisplayTalent[]>();
  for (const tt of talents) {
    if (!tiers.has(tt.tier)) tiers.set(tt.tier, []);
    tiers.get(tt.tier)!.push(tt);
  }
  const tierRows = [...tiers.entries()].sort(([a], [b]) => a - b);

  return (
    <>
      <SeoHead title={t.title} description={t.description} path="/talents" locale={locale} />
      <div className={browserStyles.page}>
        <div className={browserStyles.container}>
          <h1 className={browserStyles.pageTitle}>{t.heading}</h1>

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
        </div>
      </div>
    </>
  );
}
