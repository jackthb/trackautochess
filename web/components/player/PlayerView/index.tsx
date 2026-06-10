"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlayerGame } from "@dac/shared/types";
import { buildStatItems } from "@dac/shared/buildStatItems";
import { Button } from "@dac/shared/Button";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { SeasonHistoryGrid, type SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import { MmrSparkline, type MmrSnapshot } from "@/components/MmrSparkline";
import { MatchHistoryList } from "@/components/matches/MatchHistoryList";
import { QueenRankSparkline, type QueenRankSnapshot } from "@/components/QueenRankSparkline";
import { RankLadder } from "@/components/RankLadder";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import {
  getManualRefreshQuota,
  type ManualRefreshCadence,
  type ManualRefreshQuota,
} from "@/lib/manualRefreshQuota";
import { isAdminSteamId } from "@/lib/admin";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import {
  steamProfileUrl,
  type SteamProfile,
} from "@/lib/steam";
import styles from "./PlayerView.module.css";

const LAST_FETCHED_TICK_MS = 1000;

export interface LeaderboardPosition {
  rank: number;
  total: number;
}

export interface PlayerPageProps {
  route: string;
  steamId: string;
  steamProfile: SteamProfile;
  games: PlayerGame[];
  drodo: {
    mmr: number | null;
    max_mmr: number | null;
    mmr_level: number | null;
    queen_rank: number | null;
    last_win_at: string | number | null;
    last_top3_at: string | number | null;
    season: string | null;
    season_games: number | null;
    candy: number | null;
    chicken_count: number | null;
  } | null;
  seasons: SeasonSnapshot[];
  mmrHistory: MmrSnapshot[];
  queenRankHistory: QueenRankSnapshot[];
  leaderboardPosition: LeaderboardPosition | null;
  drodoProfileMissing: boolean;
  drodoLastFetchedAt: string | null;
  manualRefreshQuota: ManualRefreshQuota;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
}

function formatLastFetchedTimestamp(value: string | null): string {
  if (!value) return "Not fetched yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds()
  )} UTC`;
}


function formatRefreshReset(
  quota: ManualRefreshQuota,
  nowMs: number | null
): string {
  if (quota.remaining > 0) return "available now";
  if (!quota.reset_at || nowMs == null) return "cooling down";

  const resetMs = new Date(quota.reset_at).getTime();
  if (!Number.isFinite(resetMs) || resetMs <= nowMs) return "available now";

  const totalSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `available in ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const days = Math.floor(hours / 24);
    if (days > 0) return `available in ${days}d ${hours % 24}h`;
    return `available in ${hours}h ${minutes % 60}m`;
  }

  return `available in ${minutes}m ${seconds}s`;
}

function formatLastFetchedAge(value: string | null, nowMs: number | null) {
  if (!value || nowMs == null) return null;
  const fetchedMs = new Date(value).getTime();
  if (!Number.isFinite(fetchedMs)) return null;

  const seconds = Math.max(0, Math.floor((nowMs - fetchedMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;

  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

function latestMmrDelta(snapshots: MmrSnapshot[]) {
  const points = snapshots
    .filter((snapshot): snapshot is MmrSnapshot & { mmr: number } =>
      typeof snapshot.mmr === "number"
    )
    .slice()
    .sort(
      (a, b) =>
        new Date(a.snapshotted_at).getTime() -
        new Date(b.snapshotted_at).getTime()
    );

  if (points.length < 2) return null;
  const previous = points[points.length - 2];
  const latest = points[points.length - 1];
  return {
    delta: latest.mmr - previous.mmr,
    latestMmr: latest.mmr,
    previousMmr: previous.mmr,
  };
}

function HistoryLockedPanel() {
  return (
    <section className={styles.historyLocked} aria-label="Locked MMR history">
      <div className={styles.historyLockedGlow} aria-hidden="true" />
      <div className={styles.historyLockedChart} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className={styles.historyLockedCopy}>
        <div className={styles.historyLockedEyebrow}>Login-only history</div>
        <h2>Sign in via Steam to view the MMR graph.</h2>
        <p>
          MMR history, season history, Queen Rank trends, and session-to-session
          deltas are reserved for logged-in Steam users — who can also refresh
          their stats every 30 minutes, instead of once a day.
        </p>
        <SteamTrustNote source="player_history_lock" />
      </div>
      <div className={styles.historyLockedAction}>
        <SteamSignInButton source="player_history_lock" size="md" />
      </div>
    </section>
  );
}

// Always-visible Steam sign-in reassurance (no toggle) so it doesn't shift the
// graph and button. Shown under the history lock and the returning-user prompt.
function SteamTrustNote({ source }: { source: string }) {
  return (
    <div className={styles.steamTrustNote}>
      <div className={styles.steamTrustLead}>
        <span className={styles.steamTrustIcon} aria-hidden="true">i</span>
        How Steam sign-in works
      </div>
      <p>
        You sign in on <strong>steamcommunity.com</strong> using Steam OpenID.
        Track Auto Chess never sees your Steam password and cannot access your
        items or inventory; Steam only sends us your SteamID so we know which
        profile is yours.
      </p>
      <a
        href="https://partner.steamgames.com/doc/features/auth#website"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("Steam Sign In Reassurance Link Clicked", { source })}
      >
        Read Valve's OpenID sign-in docs
      </a>
    </div>
  );
}

function MmrDeltaCard({ snapshots }: { snapshots: MmrSnapshot[] }) {
  const delta = latestMmrDelta(snapshots);
  if (!delta) return null;

  const positive = delta.delta > 0;
  const neutral = delta.delta === 0;
  const signedDelta = neutral
    ? "±0"
    : `${positive ? "+" : ""}${delta.delta}`;

  return (
    <div className={styles.deltaCard}>
      <span className={styles.deltaLabel}>Since last refresh</span>
      <strong
        className={
          positive
            ? styles.deltaPositive
            : neutral
              ? styles.deltaNeutral
              : styles.deltaNegative
        }
      >
        {signedDelta} MMR
      </strong>
      <span className={styles.deltaMeta}>
        {delta.previousMmr} → {delta.latestMmr}
      </span>
    </div>
  );
}

export default function PlayerView({
  route,
  steamId,
  steamProfile,
  games,
  drodo: initialDrodo,
  seasons: initialSeasons,
  mmrHistory,
  queenRankHistory,
  leaderboardPosition,
  drodoProfileMissing: initialDrodoProfileMissing,
  drodoLastFetchedAt: initialDrodoLastFetchedAt,
  manualRefreshQuota: initialManualRefreshQuota,
}: PlayerPageProps) {
  const [drodo, setDrodo] = useState(initialDrodo);
  const [seasons, setSeasons] = useState(initialSeasons);
  const [drodoProfileMissing, setDrodoProfileMissing] = useState(
    initialDrodoProfileMissing
  );
  const [drodoLastFetchedAt, setDrodoLastFetchedAt] = useState(
    initialDrodoLastFetchedAt
  );
  const [manualRefreshQuota, setManualRefreshQuota] = useState(
    initialManualRefreshQuota
  );
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<"mmr" | "queen">("mmr");
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [sessionSteamId, setSessionSteamId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void import("@/lib/supabase").then(({ createSupabaseClient }) => {
      if (cancelled) return;
      const supabase = createSupabaseClient();
      if (!supabase) {
        setAuthReady(true);
        return;
      }

      supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        const meta = data.session?.user?.user_metadata as
          | { steam_id?: unknown }
          | null
          | undefined;
        setSessionSteamId(
          meta && typeof meta.steam_id === "string" ? meta.steam_id : null
        );
        setAccessToken(data.session?.access_token ?? null);
        setAuthReady(true);
      });
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        const meta = session?.user?.user_metadata as
          | { steam_id?: unknown }
          | null
          | undefined;
        setSessionSteamId(
          meta && typeof meta.steam_id === "string" ? meta.steam_id : null
        );
        setAccessToken(session?.access_token ?? null);
        setAuthReady(true);
      });
      unsubscribe = () => subscription.unsubscribe();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const isAdmin = isAdminSteamId(sessionSteamId);
  const isOwnProfile = sessionSteamId !== null && sessionSteamId === steamId;
  const isPriorityProfile =
    drodo?.queen_rank != null || queenRankHistory.length > 0;
  const canViewHistory = authReady && sessionSteamId !== null;
  const refreshCadence: ManualRefreshCadence =
    isAdmin || isOwnProfile || isPriorityProfile ? "owner" : "public";
  const canRefresh = authReady;
  const displayName = steamProfile.name || steamProfile.customUrl || steamId;
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl);

  const totalChickenCount = useMemo(() => {
    const sum = seasons.reduce((acc, s) => acc + (s.chicken_count ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [seasons]);

  const { tracked: trackedItems, drodo: drodoItems } = useMemo(
    () => buildStatItems(games, drodo ? { ...drodo, total_chicken_count: totalChickenCount } : null),
    [games, drodo, totalChickenCount]
  );
  const showQueenRankHistory = Boolean(drodo?.queen_rank) && queenRankHistory.length >= 2;

  // TODO: ingest total matches / avg rank / wins / preferred lineup / max damage from history pages for server-side season snapshots.
  useEffect(() => {
    setAvatarFailed(false);
  }, [steamProfile.avatarUrl]);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), LAST_FETCHED_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    setManualRefreshQuota(
      getManualRefreshQuota(document.cookie, Date.now(), {
        cadence: refreshCadence,
        target: steamId,
      })
    );
  }, [authReady, refreshCadence, steamId]);

  useEffect(() => {
    trackEvent("Player Profile Viewed", {
      route: analyticsRoute(route),
      has_mmr: Boolean(initialDrodo?.mmr),
      has_games: games.length > 0,
      game_bucket: bucketCount(games.length),
      season_bucket: bucketCount(initialSeasons.length),
      has_leaderboard_rank: Boolean(leaderboardPosition),
    });
  }, [
    games.length,
    initialDrodo?.mmr,
    initialSeasons.length,
    leaderboardPosition,
    route,
    steamId,
  ]);

  useEffect(() => {
    if (!authReady || canViewHistory) return;
    trackEvent("Player History Locked Viewed", {
      route: analyticsRoute(route),
    });
  }, [authReady, canViewHistory, route]);

  const lastFetchedTimestamp = formatLastFetchedTimestamp(drodoLastFetchedAt);
  const lastFetchedAge = formatLastFetchedAge(drodoLastFetchedAt, nowMs);
  const effectiveManualRefreshQuota = useMemo(() => {
    if (manualRefreshQuota.remaining > 0 || nowMs == null) {
      return manualRefreshQuota;
    }

    const resetMs = new Date(manualRefreshQuota.reset_at).getTime();
    if (!Number.isFinite(resetMs) || resetMs > nowMs) {
      return manualRefreshQuota;
    }

    return {
      ...manualRefreshQuota,
      used: 0,
      remaining: manualRefreshQuota.limit,
    };
  }, [manualRefreshQuota, nowMs]);
  const enforceQuota = canRefresh && !isAdmin;
  const showQuota = enforceQuota && !isOwnProfile;
  const refreshDisabled =
    !canRefresh ||
    refreshing ||
    (enforceQuota && effectiveManualRefreshQuota.remaining <= 0);
  const refreshQuotaLabel = `${effectiveManualRefreshQuota.remaining}/${effectiveManualRefreshQuota.limit}`;
  const refreshQuotaResetLabel = formatRefreshReset(effectiveManualRefreshQuota, nowMs);
  const refreshQuotaTitle =
    refreshCadence === "owner"
      ? isOwnProfile
        ? "Your refreshes"
        : "Priority refreshes"
      : "Daily profile refresh";

  const handleRefresh = async () => {
    if (!canRefresh) {
      trackEvent("Player Refresh Blocked", {
        route: analyticsRoute(route),
        reason: "auth_loading",
      });
      setRefreshError("Checking your Steam session. Try again in a moment.");
      return;
    }
    if (enforceQuota && effectiveManualRefreshQuota.remaining <= 0) {
      trackEvent("Player Refresh Blocked", {
        route: analyticsRoute(route),
        reason: "quota",
        refresh_cadence: refreshCadence,
      });
      setRefreshError(
        refreshCadence === "owner"
          ? "Refresh is temporarily unavailable. Try again later."
          : "This profile has already been refreshed today."
      );
      return;
    }

    trackEvent("Player Refresh Started", {
      route: analyticsRoute(route),
      is_admin: isAdmin,
      is_own_profile: isOwnProfile,
      refresh_cadence: refreshCadence,
      quota_bucket: bucketCount(effectiveManualRefreshQuota.remaining),
    });
    setRefreshError(null);
    setRefreshing(true);
    try {
      const resp = await fetch(
        `/api/drodo/${encodeURIComponent(steamId)}?refresh=1`,
        {
          method: "POST",
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : undefined,
        }
      );
      const data = await resp.json().catch(() => null);
      if (data?.refresh_quota) {
        setManualRefreshQuota(data.refresh_quota);
      }
      if (!resp.ok) {
        const reason =
          resp.status === 404
            ? "missing"
            : resp.status === 429
              ? "quota"
              : resp.status === 403
                ? "bot_protection"
                : "server";
        trackEvent("Player Refresh Failed", {
          route: analyticsRoute(route),
          reason,
          status: resp.status,
        });
        if (resp.status === 404) {
          setDrodoProfileMissing(true);
          setDrodo(null);
          if (typeof data?.fetched_at === "string") {
            setDrodoLastFetchedAt(data.fetched_at);
          }
        } else if (resp.status === 429) {
          setRefreshError(
            data?.error ||
              (refreshCadence === "owner"
                ? "Refresh is temporarily unavailable. Try again later."
                : "This profile has already been refreshed today.")
          );
        } else if (resp.status === 403) {
          setRefreshError("Refresh blocked by anti-bot verification.");
        } else {
          setRefreshError(
            data?.error || `Refresh failed with HTTP ${resp.status}.`
          );
        }
        return;
      }

      trackEvent("Player Refresh Succeeded", {
        route: analyticsRoute(route),
        has_mmr: data.mmr != null,
        has_seasons: Array.isArray(data.seasons),
        quota_bucket: data?.refresh_quota
          ? bucketCount(data.refresh_quota.remaining)
          : "unknown",
      });
      window.location.reload();
    } catch (error) {
      trackEvent("Player Refresh Failed", {
        route: analyticsRoute(route),
        reason: "network",
      });
      const detail =
        error instanceof Error && error.message ? ` (${error.message})` : "";
      setRefreshError(
        `Refresh request failed before the server responded${detail}.`
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.dashboard}>
          {drodo?.mmr != null && (
            <div className={styles.rankLadder}>
              <RankLadder mmr={drodo.mmr} queenRank={drodo.queen_rank} />
            </div>
          )}
          <div className={styles.playerHeader}>
            <div className={styles.playerIdentity}>
              {steamProfile.avatarUrl && !avatarFailed ? (
                <img
                  className={styles.playerAvatar}
                  src={steamProfile.avatarUrl}
                  alt={`${displayName} Steam avatar`}
                  width={72}
                  height={72}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <div className={`${styles.playerAvatar} ${styles.playerAvatarFallback}`} aria-hidden="true">
                  {displayName.charAt(0) || "?"}
                </div>
              )}
              <div className={styles.playerHeading}>
                <div className={styles.playerName}>{displayName}</div>
                <div className={styles.playerMeta}>
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {steamProfile.customUrl
                      ? `steamcommunity.com/id/${steamProfile.customUrl}`
                      : `Steam ID: ${steamId}`}
                  </a>
                </div>
                {isAdmin && leaderboardPosition && (
                  <div className={styles.leaderboardRank}>
                    <a href="/leaderboard">
                      Rank{" "}
                      <span className={styles.leaderboardRankNum}>
                        #{leaderboardPosition.rank}
                      </span>{" "}
                      <span className={styles.leaderboardRankTotal}>
                        of {leaderboardPosition.total}
                      </span>
                    </a>
                  </div>
                )}
              </div>
            </div>
            <div className={styles.playerActions}>
              <Button disabled={refreshDisabled} onClick={handleRefresh}>
                {!authReady
                  ? "Checking..."
                  : refreshing
                    ? "Refreshing..."
                    : "Refresh Stats"}
              </Button>
              {showQuota && (
                <div className={styles.refreshQuota}>
                  <span>{refreshQuotaTitle}</span>
                  <span className={styles.refreshQuotaValue}>
                    {refreshQuotaLabel} {refreshQuotaResetLabel}
                  </span>
                </div>
              )}
              {refreshError && (
                <div className={styles.refreshError}>{refreshError}</div>
              )}
              <div className={styles.lastFetched}>
                <span className={styles.lastFetchedLabel}>Last fetched</span>
                <time
                  className={styles.lastFetchedValue}
                  dateTime={drodoLastFetchedAt ?? undefined}
                >
                  {lastFetchedTimestamp}
                </time>
                {lastFetchedAge && (
                  <span className={styles.lastFetchedAge}>{lastFetchedAge}</span>
                )}
              </div>
            </div>
          </div>

          {drodoProfileMissing && !drodo && (
            <div className={styles.tableWrap} style={{ marginBottom: 32 }}>
              <div className={styles.emptyState}>
                No public Auto Chess stats found for this Steam profile.
              </div>
            </div>
          )}

          {trackedItems.length > 0 && (
            <>
              <div className="section-title">Tracked Games</div>
              <StatsGrid items={trackedItems} />
            </>
          )}

          {drodoItems.length > 0 && (
            <>
              <div className="section-title">Auto Chess</div>
              <StatsGrid items={drodoItems} />
            </>
          )}

          {canViewHistory ? (
            <>
              <MmrDeltaCard snapshots={mmrHistory} />
              {showQueenRankHistory ? (
                <div className={styles.historyPanel}>
                  <div className={styles.historyTabs} role="tablist" aria-label="Rating history">
                    <button
                      type="button"
                      className={`${styles.historyTab} ${historyTab === "mmr" ? styles.historyTabActive : ""}`}
                      onClick={() => setHistoryTab("mmr")}
                      role="tab"
                      aria-selected={historyTab === "mmr"}
                    >
                      MMR
                    </button>
                    <button
                      type="button"
                      className={`${styles.historyTab} ${historyTab === "queen" ? styles.historyTabActive : ""}`}
                      onClick={() => setHistoryTab("queen")}
                      role="tab"
                      aria-selected={historyTab === "queen"}
                    >
                      Queen Rank
                    </button>
                  </div>
                  {historyTab === "queen" ? (
                    <QueenRankSparkline snapshots={queenRankHistory} />
                  ) : (
                    <MmrSparkline seasons={seasons} snapshots={mmrHistory} />
                  )}
                </div>
              ) : (
                <MmrSparkline seasons={seasons} snapshots={mmrHistory} />
              )}

              <SeasonHistoryGrid seasons={seasons} />
            </>
          ) : authReady ? (
            <HistoryLockedPanel />
          ) : null}

          {games.length > 0 && (
            <>
              <div className="section-title">Matches</div>
              <MatchHistoryList games={games} />
            </>
          )}
        </div>
      </div>
  );
}
