import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { PageLayout } from "@/components/PageLayout";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { playerProfilePath } from "@/lib/steam";
import styles from "../leaderboard/leaderboard.module.css";
import { LastSyncedTime } from "./LastSyncedTime";

interface QueenRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  drodo_mmr: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  queen_ladder_rank: number | null;
  queen_ladder_mmr: number | null;
  queen_ladder_season: string | null;
  queen_ladder_last_seen_at: string | null;
}

const title = `Queen Players | ${SITE_TITLE}`;
const description =
  "Latest Dota Auto Chess Queen players captured from the in-game Queen ladder, with MMR and available season stats.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/queens" },
  robots: "index, follow, max-image-preview:large",
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

export const revalidate = 300;

const SELECT = [
  "steam_id::text",
  "name",
  "custom_url",
  "avatar_url",
  "drodo_mmr",
  "drodo_season",
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
    .not("queen_ladder_last_seen_at", "is", null)
    .order("queen_ladder_last_seen_at", { ascending: false, nullsFirst: false })
    .order("queen_ladder_rank", { ascending: true, nullsFirst: false })
    .order("queen_ladder_mmr", { ascending: false, nullsFirst: false })
    .order("drodo_mmr", { ascending: false, nullsFirst: false })
    .limit(300);

  if (error) return { rows: [], error: error.message };
  const normalizedRows = ((data ?? []) as unknown as QueenRow[]).map((row) => ({
    ...row,
    steam_id: String(row.steam_id),
  }));
  const latestSeenAt = normalizedRows[0]?.queen_ladder_last_seen_at ?? null;
  const rows = latestSeenAt
    ? normalizedRows.filter((row) => row.queen_ladder_last_seen_at === latestSeenAt)
    : [];

  return {
    rows,
    error: null,
  };
}

function normalizeSeason(value: string | null): string | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/\d+/);
  return match ? `s${Number(match[0])}` : raw;
}

function seasonMatches(row: QueenRow): boolean {
  const ladderSeason = normalizeSeason(row.queen_ladder_season);
  const drodoSeason = normalizeSeason(row.drodo_season);
  return !ladderSeason || !drodoSeason || ladderSeason === drodoSeason;
}

function seasonGames(row: QueenRow): number | null {
  if (!seasonMatches(row)) return null;
  return row.drodo_season_games;
}

function seasonWins(row: QueenRow): number | null {
  if (!seasonMatches(row)) return null;
  return row.drodo_chicken_count;
}

function formatWinRate(wins: number | null, games: number | null): string {
  if (wins == null || games == null || games <= 0) return "—";
  return `${Math.round((wins / games) * 100)}%`;
}

function formatWinTotal(wins: number | null): string {
  if (wins == null) return "—";
  return `${wins.toLocaleString()}`;
}

function queenMmr(row: QueenRow): number | null {
  // `queen_ladder_mmr` is captured directly from the in-game ladder/pool.
  // `drodo_mmr` is available only after a full profile search/hydration, so it
  // must be a fallback rather than a prerequisite for newly discovered Queens.
  return row.queen_ladder_mmr ?? row.drodo_mmr ?? null;
}

export default async function QueensPage() {
  const { rows, error } = await loadQueens();
  const season = rows.find((row) => row.queen_ladder_season)?.queen_ladder_season;
  const lastSyncedAt = rows[0]?.queen_ladder_last_seen_at ?? null;

  return (
    <PageLayout title="Queen Players">
      <p className={styles.lead}>
        Latest in-game Queen ladder output captured by the desktop tracker
        {season ? ` for ${season.replace(/_/g, " ").toUpperCase()}` : ""}. Rows are replaced when
        a fresh ladder upload is accepted. Season stats fill in after a profile
        is refreshed; signed-in owners are checked about hourly in the
        background.
      </p>

      {error ? (
        <div className={styles.gate}>Failed to load Queen players: {error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>No Queen players tracked yet.</div>
      ) : (
        <>
          <div className={styles["snapshot-meta"]}>
            <span>Last synced</span>
            <LastSyncedTime value={lastSyncedAt} />
          </div>
          <div className={`${styles.table} ${styles["queen-table"]}`} role="table">
            <div className={`${styles.row} ${styles["header-row"]}`}>
              <div className={`${styles.cell} ${styles["cell-rank"]}`}>Rank</div>
              <div className={styles.cell} aria-hidden="true" />
              <div className={styles.cell}>Player</div>
              <div className={styles.cell}>MMR</div>
              <div className={`${styles.cell} ${styles["hide-sm"]}`}>Wins</div>
              <div className={`${styles.cell} ${styles["hide-sm"]}`}>Games</div>
              <div className={`${styles.cell} ${styles["hide-sm"]}`}>Win rate</div>
            </div>
            {rows.map((row, index) => {
              const ladderRank = row.queen_ladder_rank ?? index + 1;
              const mmr = queenMmr(row);
              const display = row.name || row.custom_url || row.steam_id;
              const initial = display.charAt(0).toUpperCase() || "?";
              const games = seasonGames(row);
              const wins = seasonWins(row);
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
                      prefetch={false}
                    >
                      {display}
                    </Link>
                  </div>
                  <div className={`${styles.cell} ${styles["cell-mmr"]}`}>
                    {mmr != null ? mmr.toLocaleString() : "—"}
                  </div>
                  <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                    {formatWinTotal(wins)}
                  </div>
                  <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                    {games?.toLocaleString() ?? "—"}
                  </div>
                  <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                    {formatWinRate(wins, games)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </PageLayout>
  );
}
