import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/PageLayout";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { listAvatarUrl, playerProfilePath } from "@/lib/steam";
import { effectiveQueenRank, queenDisplayName, queenMmr } from "@/lib/queens";
import {
  loadQueensLeaderboard,
  newestDrodoFetchedAt,
  oldestDrodoFetchedAt,
  QUEEN_MOVE_LOOKBACK_LABEL,
  queenLastUpdatedAt,
  queenOldestUpdatedAt,
  queenSeasonGames,
  queenSeasonWins,
  type QueenMove,
} from "@/lib/queensLeaderboard";
import { QUEENS_VIEW_REFRESH_COOLDOWN_MS } from "@/lib/queensVisitor";
import { canonicalCreatorStreamUrl, loadCachedCreatorLiveStreams } from "@/lib/creators";
import styles from "./queens.module.css";
import { QueensAutoRefresh } from "./QueensAutoRefresh";
import {
  formatQueensAvailableDate,
  queensLeaderboardAvailableOn,
  queensSeasonNormalizing,
} from "./seasonGate";

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

// Rendered dynamically (live DB read per request) rather than ISR-cached. The
// leaderboard changes constantly and a 300s Full Route Cache meant a hard page
// reload showed stale ranks until the timer/revalidation caught up, while
// router.refresh() (the auto-refresh client) masked it with a live render. A
// ≤100-row query per load is cheap; the QueensAutoRefresh client polling on top
// keeps an open tab live without a manual reload.
export const dynamic = "force-dynamic";

function formatWinRate(wins: number | null, games: number | null): string {
  if (wins == null || games == null || games <= 0) return "-";
  return `${Math.round((wins / games) * 100)}%`;
}

function formatWinTotal(wins: number | null): string {
  if (wins == null) return "-";
  return `${wins.toLocaleString()}`;
}

function formatMove(move: QueenMove | null | undefined): string {
  if (!move || move.delta == null) return "-";
  if (move.delta === 0) return "0";
  return move.delta > 0 ? `+${move.delta}` : `-${Math.abs(move.delta)}`;
}

function moveClass(move: QueenMove | null | undefined): string {
  if (!move || move.delta == null || move.delta === 0) return styles.dim;
  return move.delta > 0 ? styles.up : styles.down;
}

function streamPlatform(url: string): "twitch" | "youtube" | "kick" | "douyu" | "stream" {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (hostname.includes("twitch.tv")) return "twitch";
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "youtube";
    if (hostname.includes("kick.com")) return "kick";
    if (hostname.includes("douyu.com")) return "douyu";
  } catch {
    // Fall through to the generic stream icon for malformed stored URLs.
  }
  return "stream";
}

function StreamIcon({ platform }: { platform: ReturnType<typeof streamPlatform> }) {
  if (platform === "youtube") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5a3 3 0 0 0-2.1 2.1A31.3 31.3 0 0 0 1.9 12c0 1.7.2 3.4.5 4.8a3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1c.3-1.4.5-3.1.5-4.8s-.2-3.4-.5-4.8ZM10 15.4V8.6l5.8 3.4L10 15.4Z" />
      </svg>
    );
  }
  if (platform === "kick") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 4h6v5h2V7h2V4h6v6h-3v2h3v8h-6v-3h-2v-2h-2v5H4V4Z" />
      </svg>
    );
  }
  if (platform === "douyu") {
    return (
      <img
        className={styles["stream-platform-logo"]}
        src="/stream-platforms/douyu.svg"
        alt=""
        aria-hidden="true"
      />
    );
  }
  if (platform === "twitch") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 3h16v11l-5 5h-4l-3 3H6v-3H2V7l3-4Zm2 2-2 2v9h4v3l3-3h4l3-3V5H7Zm4 3h2v5h-2V8Zm5 0h2v5h-2V8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 5h16v14H4V5Zm2 2v10h12V7H6Zm4 2.2 5 2.8-5 2.8V9.2Z" />
    </svg>
  );
}

export default async function QueensPage() {
  const seasonNormalizing = queensSeasonNormalizing();
  const leaderboardAvailableOn = queensLeaderboardAvailableOn();

  const [{ rows, error }, { streams }] = seasonNormalizing
    ? [{ rows: [], error: null }, { streams: [] }]
    : await Promise.all([loadQueensLeaderboard(), loadCachedCreatorLiveStreams()]);
  const season = rows.find((row) => row.queen_ladder_season)?.queen_ladder_season;
  const lastUpdatedAt = newestDrodoFetchedAt(rows) ?? queenLastUpdatedAt(rows);
  const oldestUpdatedAt = oldestDrodoFetchedAt(rows) ?? queenOldestUpdatedAt(rows);
  const refreshAnchorAt = oldestUpdatedAt ?? lastUpdatedAt;
  const liveSteamIds = new Set(
    streams
      .map((stream) => stream.steamId)
      .filter((steamId): steamId is string => Boolean(steamId))
  );
  const liveStreamUrls = new Set(
    streams.map((stream) => canonicalCreatorStreamUrl(stream.url))
  );

  return (
    <PageLayout title="Queen Players">
      {!seasonNormalizing ? (
        <QueensAutoRefresh
          latestFetchedAt={refreshAnchorAt}
          cooldownMs={QUEENS_VIEW_REFRESH_COOLDOWN_MS}
        />
      ) : null}
      {seasonNormalizing && leaderboardAvailableOn ? (
        <div className={styles["season-notice"]} role="status">
          <strong>Waiting for Queen ranks to normalise.</strong> It&apos;s a new
          season and the in-game Queen ladder needs time to settle. The
          leaderboard will return around{" "}
          {formatQueensAvailableDate(leaderboardAvailableOn)}.
        </div>
      ) : null}
      <p className={styles.lead}>
        {seasonNormalizing
          ? "Queen players are tracked each season. Rankings will appear here once the ladder has stabilised."
          : `Known Queen players${season ? ` for ${season.replace(/_/g, " ").toUpperCase()}` : ""}. The table renders cached Drodo profile data immediately, then refreshes visible profiles when the 5-minute cooldown has elapsed.`}
      </p>
      {error ? (
        <div className={styles.gate}>Failed to load Queen players: {error}</div>
      ) : seasonNormalizing ? null : rows.length === 0 ? (
        <div className={styles.empty}>No Queen players tracked yet.</div>
      ) : (
        <>
          <div className={`${styles.table} ${styles["queen-table"]}`} role="table">
            <div className={`${styles.row} ${styles["header-row"]}`}>
              <div className={`${styles.cell} ${styles["cell-rank"]}`}>Rank</div>
                <div className={`${styles.cell} ${styles["cell-move"]}`}>Move ({QUEEN_MOVE_LOOKBACK_LABEL})</div>
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
              const display = queenDisplayName(row, ladderRank);
              const isLive =
                liveSteamIds.has(row.steam_id) ||
                (row.stream_link
                  ? liveStreamUrls.has(canonicalCreatorStreamUrl(row.stream_link))
                  : false);
              const streamLinkClass = [
                styles["stream-link"],
                isLive ? styles["stream-link-live"] : "",
                row.stream_link && streamPlatform(row.stream_link) === "douyu"
                  ? styles["stream-link-douyu"]
                  : "",
              ]
                .filter(Boolean)
                .join(" ");
              const streamTitle = isLive
                ? `${display} stream is live`
                : row.stream_link ?? `${display} stream`;
              const initial = display.charAt(0).toUpperCase() || "?";
              const games = queenSeasonGames(row);
              const wins = queenSeasonWins(row);
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
                        src={listAvatarUrl(row.avatar_url)}
                        alt=""
                        width={32}
                        height={32}
                        referrerPolicy="no-referrer"
                        loading={index < 20 ? undefined : "lazy"}
                      />
                    ) : (
                      <div className={`${styles.avatar} ${styles["avatar-fallback"]}`}>
                        {initial}
                      </div>
                    )}
                  </div>
                  <div className={`${styles.cell} ${styles["cell-player"]}`}>
                    <Link
                      href={playerProfilePath(row.steam_id, row.custom_url)}
                      className={styles["player-link"]}
                      prefetch={false}
                    >
                      {display}
                    </Link>
                    {row.stream_link ? (
                      <a
                        className={streamLinkClass}
                        href={row.stream_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={
                          isLive
                            ? `${display} stream is live`
                            : `${display} stream`
                        }
                        title={streamTitle}
                      >
                        <StreamIcon platform={streamPlatform(row.stream_link)} />
                        {isLive ? (
                          <span className={styles["stream-live-label"]}>Live</span>
                        ) : null}
                      </a>
                    ) : null}
                  </div>
                  <div className={`${styles.cell} ${styles["cell-mmr"]}`}>
                    {mmr != null ? mmr.toLocaleString() : "-"}
                  </div>
                  <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                    {formatWinTotal(wins)}
                  </div>
                  <div className={`${styles.cell} ${styles["cell-meta"]} ${styles["hide-sm"]}`}>
                    {games?.toLocaleString() ?? "-"}
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
