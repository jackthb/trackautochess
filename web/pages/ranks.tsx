import { useRouter } from "next/router";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { normalizeLocale } from "@/lib/i18n";
import browserStyles from "@/components/EntityBrowser.module.css";

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
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);
  const title = t.title;
  const description = t.description;
  const tierGroups = buildTierGroups();

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    about: { "@type": "Thing", name: "Dota Auto Chess MMR ranks" },
  };

  return (
    <>
      <SeoHead title={title} description={description} path="/ranks" locale={locale} structuredData={structuredData} />

      <style jsx>{`
        .lead {
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          color: var(--text-secondary);
          line-height: var(--lh-relaxed);
          margin: 0 0 18px;
          max-width: 720px;
        }
        .formula {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          color: var(--text-muted);
          background: var(--bg-deep, rgba(0, 0, 0, 0.25));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-3);
          padding: 12px 14px;
          margin: 0 0 18px;
          max-width: 720px;
          line-height: 1.6;
        }
        .formula code {
          color: var(--text-primary);
        }
        .source {
          font-family: var(--font-mono);
          font-size: var(--fs-11);
          color: var(--text-muted);
          margin: 0 0 32px;
          opacity: 0.85;
        }
        .unranked-card {
          margin-bottom: 24px;
          padding: 16px 20px;
          border: 1px dashed var(--border-subtle);
          border-radius: var(--r-8);
          background: rgba(255, 255, 255, 0.02);
        }
        .unranked-head {
          display: flex;
          align-items: baseline;
          gap: 12px;
          font-family: var(--font-mono);
        }
        .unranked-name {
          font-size: var(--fs-14);
          color: var(--text-primary);
          text-transform: uppercase;
          letter-spacing: var(--tr-upper);
        }
        .unranked-desc {
          font-size: var(--fs-12);
          color: var(--text-muted);
          margin-top: 6px;
          line-height: 1.5;
        }
        .table {
          display: grid;
          grid-template-columns: 60px 56px 1fr 1fr;
          gap: 0;
          border-top: 1px solid var(--border-subtle);
        }
        .row {
          display: contents;
        }
        .cell {
          padding: 12px 14px;
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-primary);
        }
        .cell-step,
        .cell-level {
          color: var(--text-muted);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
        }
        .cell-mmr {
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .cell-mmr-min {
          color: var(--text-primary);
          font-weight: 600;
        }
        .open-ended {
          color: var(--text-muted);
        }
        .header-row .cell {
          font-size: var(--fs-11);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.02);
        }
        @media (max-width: 480px) {
          .table {
            grid-template-columns: 50px 44px 1fr 1fr;
          }
          .cell {
            padding: 10px 6px;
            font-size: var(--fs-12);
          }
        }
      `}</style>

      <div className={browserStyles.page}>
        <div className={browserStyles.container}>
          <h1 className={browserStyles.pageTitle}>{t.heading}</h1>

          <p className="lead">{t.lead}</p>

          <div className="formula">
            <code>mmr_level = clamp(floor((mmr − 340) ÷ 80), 1, 38)</code>
            <br />
            {t.formulaPre}<strong>{t.formulaGames}</strong>{t.formulaPost}
          </div>

          <p className="source">
            {t.sourcePre}
            <code>panorama/scripts/custom_game/dac.vjs_c</code>
            {t.sourceMid}
            <code>{t.sourceLabels}</code>
            {t.sourceWith}
            <code>{t.sourceFile}</code>
            {t.sourceDot}
          </p>

          <div className="unranked-card">
            <div className="unranked-head">
              <span className="unranked-name">{t.unranked}</span>
              <span className="cell-level">{t.levelZero}</span>
            </div>
            <div className="unranked-desc">{t.unrankedDesc}</div>
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
              <div className="table">
                <div className="row header-row">
                  <div className="cell cell-step">{t.headStep}</div>
                  <div className="cell cell-level">{t.headLvl}</div>
                  <div className="cell">{t.headMin}</div>
                  <div className="cell">{t.headMax}</div>
                </div>
                {rows.map((r) => (
                  <div key={r.rank} className="row">
                    <div className="cell cell-step">{r.step}</div>
                    <div className="cell cell-level">{r.level}</div>
                    <div className="cell cell-mmr cell-mmr-min">
                      {r.minMmr.toLocaleString()}
                    </div>
                    <div className="cell cell-mmr">
                      {r.maxMmr === null ? (
                        <span className="open-ended">{t.noCap}</span>
                      ) : (
                        r.maxMmr.toLocaleString()
                      )}
                    </div>
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
