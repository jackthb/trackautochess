import type { SupabaseClient } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { getAllTalents, getTierLabel, type DisplayTalent } from "@/lib/talents";
import browserStyles from "@/components/EntityBrowser.module.css";
import cardStyles from "@/components/EntityCard.module.css";

interface TalentsPageProps {
  supabase: SupabaseClient | null;
}

export default function TalentsPage({ supabase }: TalentsPageProps) {
  void supabase;
  const title = `Talents | ${SITE_TITLE}`;
  const description =
    "Browse all Dota Auto Chess talent choices by round, compare branch A/B effects, and quickly cross-reference patch notes updates.";

  const talents = getAllTalents();

  const tiers = new Map<number, DisplayTalent[]>();
  for (const t of talents) {
    if (!tiers.has(t.tier)) tiers.set(t.tier, []);
    tiers.get(t.tier)!.push(t);
  }
  const tierRows = [...tiers.entries()].sort(([a], [b]) => a - b);

  return (
    <>
      <SeoHead title={title} description={description} path="/talents" localized={false} />
      <div className={browserStyles.page}>
        <div className={browserStyles.container}>
          <h1 className={browserStyles.pageTitle}>Talents</h1>

          {tierRows.map(([tier, entries]) => (
            <section key={tier} className={browserStyles.panel}>
              <div className={browserStyles.panelHeader}>
                <span>{getTierLabel(tier)}</span>
                <span className={browserStyles.count}>{entries.length}</span>
              </div>
              <div className={`${browserStyles.grid} ${browserStyles.gridRelic}`}>
                {entries.map((t) => (
                  <div
                    key={t.key}
                    className={`${cardStyles.card} ${cardStyles.relic}`}
                    style={{ cursor: "default" }}
                  >
                    <div className={cardStyles.body}>
                      <div className={cardStyles.name}>{t.name}</div>
                      <div className={cardStyles.desc}>{t.description}</div>
                    </div>
                    <div className={cardStyles.level}>{t.branch}</div>
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
