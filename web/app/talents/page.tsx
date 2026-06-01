import type { Metadata } from "next";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllTalents, getTierLabel, type DisplayTalent } from "@/lib/talents";
import browserStyles from "@/components/EntityBrowser.module.css";
import cardStyles from "@/components/EntityCard.module.css";
import { PageLayout } from "@/components/PageLayout";

// App Router migration of pages/talents.tsx. getStaticProps -> direct call in
// the Server Component (the data helpers are sync JSON reads); SeoHead ->
// static metadata + a JSON-LD <script>; shared chrome comes from
// app/layout.tsx. Single (English) locale.

const title = `Talents | ${SITE_TITLE}`;
const description =
  "Browse all Dota Auto Chess talent choices by round, compare branch A/B effects, and quickly cross-reference patch notes updates.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/talents" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/talents",
    locale: "en_US",
    images: ["/logo.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/logo.svg"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Dota Auto Chess talents",
  description,
  about: "Dota Auto Chess talents",
};

export default function TalentsPage() {
  const talents = getAllTalents(DEFAULT_LOCALE);

  const tiers = new Map<number, DisplayTalent[]>();
  for (const tt of talents) {
    if (!tiers.has(tt.tier)) tiers.set(tt.tier, []);
    tiers.get(tt.tier)!.push(tt);
  }
  const tierRows = [...tiers.entries()].sort(([a], [b]) => a - b);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <PageLayout title="Talents">
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
