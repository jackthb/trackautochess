import type { Metadata } from "next";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import browserStyles from "@/components/EntityBrowser.module.css";
import { PageLayout } from "@/components/PageLayout";
import styles from "./ranks.module.css";

const t = {
  title: `Ranks | ${SITE_TITLE}`,
  description:
    "Dota Auto Chess MMR rank brackets — Pawn through Queen, with the exact MMR thresholds for every step, taken straight from the game's panorama source.",
  heading: "Ranks",
  lead:
    "Every Dota Auto Chess rank, from Pawn-1 up to Queen. The MMR thresholds below are derived from the canonical formula the game client uses to convert your MMR into a rank tier.",
  formulaPre:
    "Each tier is 80 MMR wide. Pawn-1 catches everyone below 500 MMR (the clamp), and Queen catches everyone at 3380 or above. New accounts must play at least ",
  formulaGames: "5 games",
  formulaPost: " before they get a rank — until then they show as Unranked.",
  sourcePre: "Source: ",
  sourceMid: " → ",
  sourceLabels: "GetMMRLevelByScore()",
  sourceWith: ", with rank labels from ",
  sourceFile: "resource/addon_english.txt",
  sourceDot: ".",
  unranked: "Unranked",
  levelZero: "Level 0",
  unrankedDesc:
    "Shown to any player with fewer than 5 ranked games this season. No MMR is displayed publicly until placement is complete.",
  headStep: "Step",
  headLvl: "Lvl",
  headMin: "Min MMR",
  headMax: "Max MMR",
  noCap: "no cap",
};

const title = t.title;
const description = t.description;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/ranks" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/ranks",
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
  "@type": "WebPage",
  name: title,
  description,
  about: { "@type": "Thing", name: "Dota Auto Chess MMR ranks" },
};

// Source of truth: GetMMRLevelByScore in
// panorama/scripts/custom_game/dac.vjs_c (Dota Auto Chess workshop VPK).
//
//   mmr_level = clamp(floor((mmr - 340) / 80), 1, 38)
//   if games_played < 5: mmr_level = 0   (Unranked)
//
// Tier names per resource/addon_english.txt (text_player_level_*):
//   1-9   Pawn 1-9
//   10-18 Knight 1-9
//   19-27 Bishop 1-9
//   28-36 Rook 1-9
//   37    King
//   38    Queen
const STEP = 80;
const OFFSET = 340;

const TIER_DEFS: { tier: string; start: number; count: number; color: string }[] = [
  { tier: "Pawn", start: 1, count: 9, color: "var(--text-muted)" },
  { tier: "Knight", start: 10, count: 9, color: "#7ea7d8" },
  { tier: "Bishop", start: 19, count: 9, color: "#b48ee2" },
  { tier: "Rook", start: 28, count: 9, color: "#e2a35a" },
  { tier: "King", start: 37, count: 1, color: "#e26b6b" },
  { tier: "Queen", start: 38, count: 1, color: "var(--gold, #d4af37)" },
];

function mmrRangeForLevel(level: number): { min: number; max: number | null } {
  const min = level === 1 ? 0 : level * STEP + OFFSET;
  const max = level === 38 ? null : (level + 1) * STEP + OFFSET - 1;
  return { min, max };
}

interface BracketRow {
  rank: string;
  step: string;
  level: number;
  minMmr: number;
  maxMmr: number | null;
}

function buildTierGroups(): { tier: string; color: string; rows: BracketRow[] }[] {
  return TIER_DEFS.map(({ tier, start, count, color }) => {
    const rows: BracketRow[] = [];
    for (let i = 0; i < count; i++) {
      const level = start + i;
      const stepLabel = count > 1 ? String(i + 1) : "—";
      const range = mmrRangeForLevel(level);
      rows.push({
        rank: count > 1 ? `${tier}-${i + 1}` : tier,
        step: stepLabel,
        level,
        minMmr: range.min,
        maxMmr: range.max,
      });
    }
    return { tier, color, rows };
  });
}

export default function RanksPage() {
  const tierGroups = buildTierGroups();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <PageLayout title={t.heading}>

          <p className={styles.lead}>{t.lead}</p>

          <div className={styles.formula}>
            <code>mmr_level = clamp(floor((mmr − 340) ÷ 80), 1, 38)</code>
            <br />
            {t.formulaPre}<strong>{t.formulaGames}</strong>{t.formulaPost}
          </div>

          <p className={styles.source}>
            {t.sourcePre}
            <code>panorama/scripts/custom_game/dac.vjs_c</code>
            {t.sourceMid}
            <code>{t.sourceLabels}</code>
            {t.sourceWith}
            <code>{t.sourceFile}</code>
            {t.sourceDot}
          </p>

          <div className={styles["unranked-card"]}>
            <div className={styles["unranked-head"]}>
              <span className={styles["unranked-name"]}>{t.unranked}</span>
              <span className={styles["cell-level"]}>{t.levelZero}</span>
            </div>
            <div className={styles["unranked-desc"]}>{t.unrankedDesc}</div>
          </div>

          {tierGroups.map(({ tier, color, rows }) => (
            <section key={tier} className={browserStyles.panel}>
              <div
                className={browserStyles.panelHeader}
                style={{ color }}
              >
                <span>{tier}</span>
                <span className={browserStyles.count}>{rows.length}</span>
              </div>
              <div className={styles.table}>
                <div className={`${styles.row} ${styles["header-row"]}`}>
                  <div className={`${styles.cell} ${styles["cell-step"]}`}>{t.headStep}</div>
                  <div className={`${styles.cell} ${styles["cell-level"]}`}>{t.headLvl}</div>
                  <div className={styles.cell}>{t.headMin}</div>
                  <div className={styles.cell}>{t.headMax}</div>
                </div>
                {rows.map((r) => (
                  <div key={r.rank} className={styles.row}>
                    <div className={`${styles.cell} ${styles["cell-step"]}`}>{r.step}</div>
                    <div className={`${styles.cell} ${styles["cell-level"]}`}>{r.level}</div>
                    <div className={`${styles.cell} ${styles["cell-mmr"]} ${styles["cell-mmr-min"]}`}>
                      {r.minMmr.toLocaleString()}
                    </div>
                    <div className={`${styles.cell} ${styles["cell-mmr"]}`}>
                      {r.maxMmr === null ? (
                        <span className={styles["open-ended"]}>{t.noCap}</span>
                      ) : (
                        r.maxMmr.toLocaleString()
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
      </PageLayout>
    </>
  );
}
