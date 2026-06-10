import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/PageLayout";
import { levelToRankName, mmrToLevel } from "@/lib/ranks";
import { SITE_TITLE } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase";
import { playerProfilePath } from "@/lib/steam";
import styles from "./leaderboard.module.css";

interface LeaderboardRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
}

interface LeaderboardData {
  rows: LeaderboardRow[];
  currentSeason: string | null;
  error: string | null;
}

export const metadata: Metadata = {
  title: `Leaderboard | ${SITE_TITLE}`,
  description: "Track Auto Chess beta leaderboard.",
  robots: "noindex, nofollow",
  alternates: { canonical: "/leaderboard" },
};

export const revalidate = 300;

const LEADERBOARD_SELECT = [
  "steam_id::text",
  "name",
  "custom_url",
  "avatar_url",
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_mmr_level",
  "drodo_season",
  "drodo_season_games",
  "drodo_chicken_count",
].join(", ");

async function loadLeaderboard(): Promise<LeaderboardData> {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return {
      rows: [],
      currentSeason: null,
      error: "Database is not configured.",
    };
  }

  const { data, error } = await supabase
    .from("users")
    .select(LEADERBOARD_SELECT)
    .not("drodo_last_fetched_at", "is", null)
    .eq("drodo_profile_missing", false)
    .order("drodo_mmr", { ascending: false, nullsFirst: false })
    .order("drodo_season_games", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    return { rows: [], currentSeason: null, error: error.message };
  }

  const rows = ((data ?? []) as unknown as LeaderboardRow[]).map((row) => ({
    ...row,
    steam_id: String(row.steam_id),
  }));

  const seasonCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.drodo_mmr != null && row.drodo_season) {
      seasonCounts.set(
        row.drodo_season,
        (seasonCounts.get(row.drodo_season) ?? 0) + 1
      );
    }
  }

  let currentSeason: string | null = null;
  let max = 0;
  for (const [season, count] of seasonCounts) {
    if (count > max) {
      max = count;
      currentSeason = season;
    }
  }

  return { rows, currentSeason, error: null };
}

export default async function LeaderboardPage() {
  const { rows, currentSeason, error } = await loadLeaderboard();
  const seasonLabel = currentSeason ? currentSeason.toUpperCase() : "current season";

  return (
    <PageLayout title="Leaderboard">
      <p className={styles.lead}>
        Every tracked Auto Chess player ranked by current{" "}
        <strong>{seasonLabel}</strong> MMR. Players appear here once their
        profile has been pulled from Drodo. Unranked players (fewer than 5
        placement games) sit at the bottom.
      </p>

      {error ? (
        <div className={styles.gate}>Failed to load leaderboard: {error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>No players tracked yet.</div>
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
            <div className={`${styles.cell} ${styles["hide-sm"]}`}>Wins</div>
          </div>
          {rows.map((row, i) => {
            const rank = i + 1;
            const ranked = row.drodo_mmr != null;
            const level = ranked
              ? (row.drodo_mmr_level ?? mmrToLevel(row.drodo_mmr))
              : 0;
            const tier = ranked ? levelToRankName(level) : "Unranked";
            const initial = (
              row.name?.charAt(0) ||
              row.custom_url?.charAt(0) ||
              "?"
            ).toUpperCase();
            const display = row.name || row.custom_url || row.steam_id;
            const rankClass =
              rank === 1
                ? styles.gold
                : rank === 2
                  ? styles.silver
                  : rank === 3
                    ? styles.bronze
                    : "";

            return (
              <div key={row.steam_id} className={styles.row}>
                <div
                  className={`${styles.cell} ${styles["cell-rank"]} ${
                    rank <= 3 ? `${styles["top-rank"]} ${rankClass}` : ""
                  }`}
                >
                  {ranked ? `#${rank}` : "-"}
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
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className={`${styles.avatar} ${styles["avatar-fallback"]}`}
                      aria-hidden="true"
                    >
                      {initial}
                    </span>
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
                  {row.custom_url && row.name && row.custom_url !== row.name && (
                    <span className={styles["player-vanity"]}>
                      /{row.custom_url}
                    </span>
                  )}
                </div>
                <div
                  className={`${styles.cell} ${styles["cell-mmr"]} ${
                    ranked ? "" : styles.dim
                  }`}
                >
                  {ranked ? row.drodo_mmr : "-"}
                </div>
                <div
                  className={`${styles.cell} ${styles["cell-meta"]} ${
                    ranked ? "" : styles.dim
                  }`}
                >
                  {ranked ? level : "-"}
                </div>
                <div
                  className={`${styles.cell} ${styles["cell-meta"]} ${
                    ranked ? "" : styles.dim
                  }`}
                >
                  {tier}
                </div>
                <div
                  className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}
                >
                  {row.drodo_season_games ?? "-"}
                </div>
                <div
                  className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}
                >
                  {row.drodo_chicken_count ?? "-"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
