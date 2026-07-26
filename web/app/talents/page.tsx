import type { Metadata } from "next";
import { pageMetadata, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import Link from "next/link";
import { getAllTalents, getTierRound, type DisplayTalent } from "@/lib/talents";
import { PageLayout } from "@/components/PageLayout";
import styles from "./talents.module.css";

const title = `Talents | ${SITE_TITLE}`;
const description =
  "Browse every Dota Auto Chess talent by milestone round, see both options for each, and cross-reference patch-note updates.";

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: "/talents",
});

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
  // In-game the talent tree reads top-down from the latest milestone, so show
  // the highest round first.
  const tierRows = [...tiers.entries()].sort(([a], [b]) => b - a);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <PageLayout title="Talents">
        <p className={styles.intro}>
          At each milestone round you settle one of two talents for your
          courier. The option you skip stays locked until round 45, when every
          talent unlocks for all players. The{" "}
          <Link href="/relics/leafy-essence" className={styles.introLink}>
            Leafy Essence
          </Link>{" "}
          relic unlocks all of your skipped talents early.
        </p>
        <div className={styles.tree}>
          {tierRows.map(([tier, entries]) => {
            const [left, right] = [...entries].sort((a, b) =>
              a.branch.localeCompare(b.branch),
            );
            const round = getTierRound(tier);
            return (
              <div key={tier} className={styles.row}>
                <Option talent={left} side="left" />
                <span className={styles.circle}>{round ?? tier}</span>
                <Option talent={right} side="right" />
              </div>
            );
          })}
        </div>
      </PageLayout>
    </>
  );
}

function Option({
  talent,
  side,
}: {
  talent: DisplayTalent | undefined;
  side: "left" | "right";
}) {
  if (!talent) return <div className={styles.option} />;
  return (
    <div
      className={`${styles.option} ${side === "left" ? styles.optionLeft : styles.optionRight}`}
    >
      <div className={styles.optionName}>{talent.name}</div>
      <div className={styles.optionDesc}>{talent.description}</div>
    </div>
  );
}
