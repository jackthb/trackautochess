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
  drodo_raw_data: Record<string, unknown> | null;
  queen_ladder_rank: number | null;
  queen_ladder_mmr: number | null;
  queen_ladder_season: string | null;
  queen_ladder_last_seen_at: string | null;
  move?: QueenMove | null;
}

interface QueenSnapshotRow {
  steam_id: string;
  queen_rank: number | null;
  snapshotted_at: string;
}

interface QueenMove {
  latestRank: number;
  previousRank: number | null;
  delta: number | null;
}

const title = `Queen Players | ${SITE_TITLE}`;
const description =
  "Latest Dota Auto Chess Queen players captured from the in-game Queen ladder and refreshed profile snapshots, with MMR, rank movement, and available season stats.";

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

export const revalidate = 600;
const QUEEN_TABLE_LIMIT = 100;

const SELECT = [
  "steam_id::text",
  "name",
  "custom_url",
  "avatar_url",
  "drodo_mmr",
  "drodo_season",
  "drodo_season_games",
  "drodo_chicken_count",
  "drodo_raw_data",
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
    .or("queen_ladder_last_seen_at.not.is.null,drodo_raw_data->>queen_rank.not.is.null")
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
  const rows = (latestSeenAt
    ? normalizedRows.filter(
        (row) => row.queen_ladder_last_seen_at === latestSeenAt || profileQueenRank(row) != null
      )
    : normalizedRows.filter((row) => profileQueenRank(row) != null)
  ).sort((a, b) => {
    const aRank = effectiveQueenRank(a) ?? Number.MAX_SAFE_INTEGER;
    const bRank = effectiveQueenRank(b) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank || (queenMmr(b) ?? -1) - (queenMmr(a) ?? -1);
  }).filter((row) => {
    const rank = effectiveQueenRank(row);
    return rank == null || rank <= QUEEN_TABLE_LIMIT;
  }).slice(0, QUEEN_TABLE_LIMIT);

  if (rows.length === 0) {
    return { rows, error: null };
  }

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("mmr_snapshots")
    .select("steam_id::text, queen_rank, snapshotted_at")
    .in(
      "steam_id",
      rows.map((row) => row.steam_id)
    )
    .not("queen_rank", "is", null)
    .order("steam_id", { ascending: true })
    .order("snapshotted_at", { ascending: false })
    .limit(rows.length * 8);

  if (snapshotsError) {
    console.error("Failed to load Queen rank movement:", snapshotsError.message);
  }

  const moves = buildQueenMoves((snapshots ?? []) as unknown as QueenSnapshotRow[]);

  return {
    rows: rows.map((row) => ({ ...row, move: moves.get(row.steam_id) ?? null })),
    error: null,
  };
}

function buildQueenMoves(snapshots: QueenSnapshotRow[]): Map<string, QueenMove> {
  const bySteamId = new Map<string, QueenSnapshotRow[]>();
  for (const snapshot of snapshots) {
    if (typeof snapshot.queen_rank !== "number") continue;
    const steamId = String(snapshot.steam_id);
    const list = bySteamId.get(steamId) ?? [];
    list.push({ ...snapshot, steam_id: steamId });
    bySteamId.set(steamId, list);
  }

  const moves = new Map<string, QueenMove>();
  for (const [steamId, list] of bySteamId) {
    const ordered = [...list].sort(
      (a, b) =>
        new Date(b.snapshotted_at).getTime() - new Date(a.snapshotted_at).getTime()
    );
    const latestRank = ordered[0]?.queen_rank ?? null;
    if (latestRank == null) continue;
    const previousRank =
      ordered.find((snapshot) => snapshot.queen_rank !== latestRank)?.queen_rank ?? null;
    moves.set(steamId, {
      latestRank,
      previousRank,
      delta: previousRank == null ? null : previousRank - latestRank,
    });
  }
  return moves;
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

function profileQueenRank(row: QueenRow): number | null {
  const value = row.drodo_raw_data?.queen_rank;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function effectiveQueenRank(row: QueenRow): number | null {
  return row.queen_ladder_rank ?? profileQueenRank(row);
}

function formatMove(move: QueenMove | null | undefined): string {
  if (!move || move.delta == null) return "—";
  if (move.delta === 0) return "0";
  return move.delta > 0 ? `↑${move.delta}` : `↓${Math.abs(move.delta)}`;
}

function moveClass(move: QueenMove | null | undefined): string {
  if (!move || move.delta == null || move.delta === 0) return styles.dim;
  return move.delta > 0 ? styles.up : styles.down;
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
        is refreshed; Queens and recently signed-in users are checked about every 10 minutes in the
        background. The table is capped to the known top 100; profile refreshes
        are used to fill missing ranks when we know them, so visible rank numbers
        may skip slots until the next full in-game ladder capture fills the
        surrounding players.
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
              <div className={`${styles.cell} ${styles["cell-move"]}`}>Move</div>
              <div className={styles.cell} aria-hidden="true" />
              <div className={styles.cell}>Player</div>
              <div className={styles.cell}>MMR</div>
              <div className={`${styles.cell} ${styles["hide-sm"]}`}>Wins</div>
              <div className={`${styles.cell} ${styles["hide-sm"]}`}>Games</div>
              <div className={`${styles.cell} ${styles["hide-sm"]}`}>Win rate</div>
            </div>
            {rows.map((row, index) => {
              const ladderRank = effectiveQueenRank(row) ?? index + 1;
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
                  <div className={`${styles.cell} ${styles["cell-move"]} ${moveClass(row.move)}`}>
                    {formatMove(row.move)}
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
