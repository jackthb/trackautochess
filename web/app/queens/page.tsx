import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { PageLayout } from "@/components/PageLayout";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { levelToRankName, mmrToLevel } from "@/lib/ranks";
import { playerProfilePath } from "@/lib/steam";
import styles from "../leaderboard/leaderboard.module.css";

interface QueenRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  drodo_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  queen_ladder_rank: number | null;
  queen_ladder_mmr: number | null;
  queen_ladder_season: string | null;
  queen_ladder_last_seen_at: string | null;
}

const title = `Queen Players | ${SITE_TITLE}`;
const description =
  "Current Dota Auto Chess Queen players discovered from the in-game Queen ladder and tracked Drodo profiles.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/queens" },
  robots: "noindex, nofollow",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/queens",
    images: ["/logo.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/logo.svg"],
  },
};

const SELECT = [
  "steam_id::text",
  "name",
  "custom_url",
  "avatar_url",
  "drodo_mmr",
  "drodo_mmr_level",
  "drodo_season_games",
  "drodo_chicken_count",
  "queen_ladder_rank",
  "queen_ladder_mmr",
  "queen_ladder_season",
  "queen_ladder_last_seen_at",
].join(", ");

async function loadQueens(): Promise<{ rows: QueenRow[]; error: string | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { rows: [], error: "Database is not configured." };
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("users")
    .select(SELECT)
    .or("queen_ladder_last_seen_at.not.is.null,drodo_mmr_level.eq.38,drodo_mmr.gte.3380")
    .order("queen_ladder_rank", { ascending: true, nullsFirst: false })
    .order("drodo_mmr", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data ?? []) as unknown as QueenRow[]).map((row) => ({
      ...row,
      steam_id: String(row.steam_id),
    })),
    error: null,
  };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function QueensPage() {
  const { rows, error } = await loadQueens();
  const season = rows.find((row) => row.queen_ladder_season)?.queen_ladder_season;

  return (
    <PageLayout title="Queen Players">
      <p className={styles.lead}>
        The in-game Queen ladder is now captured by the desktop tracker and
        cached here. This page also includes tracked profiles whose current MMR
        is high enough for Queen, so players can appear before their full Drodo
        profile refresh completes{season ? ` for ${season.toUpperCase()}` : ""}.
      </p>

      {error ? (
        <div className={styles.gate}>Failed to load Queen players: {error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>No Queen players tracked yet.</div>
      ) : (
        <div className={styles.table} role="table">
          <div className={`${styles.row} ${styles["header-row"]}`}>
            <div className={`${styles.cell} ${styles["cell-rank"]}`}>Rank</div>
            <div className={styles.cell} aria-hidden="true" />
            <div className={styles.cell}>Player</div>
            <div className={styles.cell}>MMR</div>
            <div className={styles.cell}>Lvl</div>
            <div className={styles.cell}>Tier</div>
            <div className={`${styles.cell} ${styles["hide-sm"]}`}>Games</div>
            <div className={`${styles.cell} ${styles["hide-sm"]}`}>Seen</div>
          </div>
          {rows.map((row, index) => {
            const ladderRank = row.queen_ladder_rank ?? index + 1;
            const mmr = row.queen_ladder_mmr ?? row.drodo_mmr;
            const level = row.drodo_mmr_level ?? mmrToLevel(mmr);
            const tier = levelToRankName(level || 38) || "Queen";
            const display = row.name || row.custom_url || row.steam_id;
            const initial = display.charAt(0).toUpperCase() || "?";
            const rankClass =
              ladderRank === 1
                ? styles.gold
                : ladderRank === 2
                  ? styles.silver
                  : ladderRank === 3
                    ? styles.bronze
                    : "";
            return (
              <div key={row.steam_id} className={styles.row}>
                <div
                  className={`${styles.cell} ${styles["cell-rank"]} ${ladderRank <= 3 ? `${styles["top-rank"]} ${rankClass}` : ""}`}
                >
                  #{ladderRank}
                </div>
                <div className={`${styles.cell} ${styles["cell-avatar"]}`}>
                  {row.avatar_url ? (
                    <img
                      className={styles.avatar}
                      src={row.avatar_url}
                      alt=""
                      width={32}
                      height={32}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className={`${styles.avatar} ${styles["avatar-fallback"]}`}>
                      {initial}
                    </div>
                  )}
                </div>
                <div className={styles.cell}>
                  <Link
                    href={playerProfilePath(row.steam_id, row.custom_url)}
                    className={styles["player-link"]}
                  >
                    {display}
                  </Link>
                </div>
                <div className={`${styles.cell} ${styles["cell-mmr"]}`}>
                  {mmr != null ? mmr.toLocaleString() : "—"}
                </div>
                <div className={`${styles.cell} ${styles["cell-meta"]}`}>
                  {level || 38}
                </div>
                <div className={`${styles.cell} ${styles["cell-meta"]}`}>{tier}</div>
                <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                  {row.drodo_season_games?.toLocaleString() ?? "—"}
                </div>
                <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                  {formatDate(row.queen_ladder_last_seen_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
