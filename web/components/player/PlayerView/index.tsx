"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayerGame } from "@dac/shared/types";
import { buildStatItems } from "@dac/shared/buildStatItems";
import { Button } from "@dac/shared/Button";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { SeasonHistoryGrid, type SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import { MmrSparkline, type MmrSnapshot } from "@/components/MmrSparkline";
import {
  buildMmrSeasonTabs,
  preferredMmrSeasonKey,
} from "@/components/MmrSparkline/seasonHistory";
import { MatchHistoryList } from "@/components/matches/MatchHistoryList";
import {
  QueenRankSparkline,
  hasQueenRankHistory,
  type QueenRankSnapshot,
} from "@/components/QueenRankSparkline";
import { RankLadder } from "@/components/RankLadder";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import {
  getManualRefreshQuota,
  type ManualRefreshCadence,
  type ManualRefreshQuota,
} from "@/lib/manualRefreshQuota";
import { useIsAdmin } from "@/lib/admin";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import {
  DRODO_FRESH_TTL_MS,
  HOT_PROFILE_REFRESH_TTL_SECONDS,
  type DrodoProfileRow,
} from "@/lib/drodo";
import {
  DRODO_LIVE_FETCH_ENABLED,
  DRODO_MMR_ENABLED,
  DRODO_OUTAGE_NOTICE,
} from "@/lib/drodoLive";
import { drodoStatsFromProfile } from "@/components/player/playerData";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { type SteamProfile } from "@/lib/steam";
import styles from "./PlayerView.module.css";

const LAST_FETCHED_TICK_MS = 1000;

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

// Parked: the "since last refresh" delta now renders inside the MmrSparkline
// header. Kept here (commented) so the standalone card can be revived easily.
/*
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
*/

function historyWithCurrentMmr(
  snapshots: MmrSnapshot[],
  mmr: number | null | undefined,
  season: string | null | undefined,
  snapshottedAt: string | null | undefined
): MmrSnapshot[] {
  if (typeof mmr !== "number" || !snapshottedAt) return snapshots;
  return [
    ...snapshots,
    {
      mmr,
      season,
      snapshotted_at: snapshottedAt,
    },
  ];
}

function historyWithCurrentQueenRank(
  snapshots: QueenRankSnapshot[],
  queenRank: number | null | undefined,
  snapshottedAt: string | null | undefined
): QueenRankSnapshot[] {
  if (typeof queenRank !== "number" || !snapshottedAt) return snapshots;
  return [
    ...snapshots,
    {
      queen_rank: queenRank,
      snapshotted_at: snapshottedAt,
    },
  ];
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

// Parked alongside latestMmrDelta above — see note there.
/*
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
*/

type RefreshedDrodoProfile = DrodoProfileRow & {
  seasons?: unknown;
  mmr_history?: unknown;
  queen_rank_history?: unknown;
};

type HistoryTab = "mmr" | "queen";

function isMmrSnapshot(value: unknown): value is MmrSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    (typeof row.mmr === "number" || row.mmr === null) &&
    typeof row.snapshotted_at === "string" &&
    (typeof row.season === "string" || row.season == null)
  );
}

function isQueenRankSnapshot(value: unknown): value is QueenRankSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    (typeof row.queen_rank === "number" || row.queen_rank === null) &&
    typeof row.snapshotted_at === "string"
  );
}

export default function PlayerView({
  route,
  steamId,
  steamProfile,
  games,
  drodo: initialDrodo,
  seasons: initialSeasons,
  mmrHistory: initialMmrHistory,
  queenRankHistory: initialQueenRankHistory,
  drodoProfileMissing: initialDrodoProfileMissing,
  drodoLastFetchedAt: initialDrodoLastFetchedAt,
  manualRefreshQuota: initialManualRefreshQuota,
}: PlayerPageProps) {
  const [drodo, setDrodo] = useState(initialDrodo);
  const [seasons, setSeasons] = useState(initialSeasons);
  const [mmrHistory, setMmrHistory] = useState(initialMmrHistory);
  const [queenRankHistory, setQueenRankHistory] = useState(
    initialQueenRankHistory
  );
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
  const [historyTab, setHistoryTab] = useState<HistoryTab>("mmr");
  const [mmrSeasonKey, setMmrSeasonKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const {
    ready: authReady,
    steamId: sessionSteamId,
    accessToken,
  } = useSupabaseSession();

  const isAdmin = useIsAdmin();
  const isOwnProfile = sessionSteamId !== null && sessionSteamId === steamId;
  const isPriorityProfile =
    drodo?.queen_rank != null || queenRankHistory.length > 0;
  const canViewHistory = authReady && sessionSteamId !== null;
  const refreshCadence: ManualRefreshCadence =
    isAdmin || isOwnProfile || isPriorityProfile ? "owner" : "public";
  const canRefresh = authReady;
  const displayName = steamProfile.name || steamProfile.customUrl || steamId;

  const totalChickenCount = useMemo(() => {
    const sum = seasons.reduce((acc, s) => acc + (s.chicken_count ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [seasons]);

  const { tracked: trackedItems, drodo: drodoItems } = useMemo(
    () =>
      buildStatItems(
        games,
        drodo
          ? {
              ...drodo,
              total_chicken_count: totalChickenCount,
              rankOnly: !DRODO_MMR_ENABLED,
            }
          : null
      ),
    [games, drodo, totalChickenCount]
  );
  const effectiveMmrHistory = useMemo(
    () =>
      historyWithCurrentMmr(
        mmrHistory,
        drodo?.mmr,
        drodo?.season,
        drodoLastFetchedAt
      ),
    [mmrHistory, drodo?.mmr, drodo?.season, drodoLastFetchedAt]
  );
  const mmrSeasonTabs = useMemo(
    () => buildMmrSeasonTabs(effectiveMmrHistory, drodo?.season),
    [effectiveMmrHistory, drodo?.season]
  );
  const defaultMmrSeasonKey = useMemo(
    () =>
      preferredMmrSeasonKey(
        mmrSeasonTabs,
        effectiveMmrHistory,
        drodo?.season
      ),
    [mmrSeasonTabs, effectiveMmrHistory, drodo?.season]
  );
  const effectiveQueenRankHistory = useMemo(
    () =>
      historyWithCurrentQueenRank(
        queenRankHistory,
        drodo?.queen_rank,
        drodoLastFetchedAt
      ),
    [queenRankHistory, drodo?.queen_rank, drodoLastFetchedAt]
  );
  const showQueenRankHistory =
    Boolean(drodo?.queen_rank) && hasQueenRankHistory(effectiveQueenRankHistory);
  const historyTabs = useMemo(
    () =>
      [
        { key: "mmr" as const, label: "MMR" },
        ...(showQueenRankHistory
          ? [{ key: "queen" as const, label: "Queen rank" }]
          : []),
      ],
    [showQueenRankHistory]
  );

  // TODO: ingest total matches / avg rank / wins / preferred lineup / max damage from history pages for server-side season snapshots.
  useEffect(() => {
    setAvatarFailed(false);
  }, [steamProfile.avatarUrl]);

  useEffect(() => {
    if (!historyTabs.some((tab) => tab.key === historyTab)) {
      setHistoryTab("mmr");
    }
  }, [historyTab, historyTabs]);

  useEffect(() => {
    setMmrSeasonKey(defaultMmrSeasonKey);
  }, [defaultMmrSeasonKey]);

  useEffect(() => {
    if (mmrSeasonTabs.some((tab) => tab.key === mmrSeasonKey)) return;
    setMmrSeasonKey(defaultMmrSeasonKey);
  }, [defaultMmrSeasonKey, mmrSeasonKey, mmrSeasonTabs]);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), LAST_FETCHED_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Stale-while-revalidate for profile stats. In rank-only mode this is what
  // keeps a rank current on a page hit: cached stats render immediately, then
  // a background /api/drodo call refreshes mmr_level and queen rank.
  const autoRefreshTriggered = useRef(false);
  useEffect(() => {
    if (!DRODO_LIVE_FETCH_ENABLED) return;
    if (autoRefreshTriggered.current) return;
    if (!initialDrodo || initialDrodoProfileMissing) return;
    const isHotProfile =
      initialDrodo.queen_rank != null || queenRankHistory.length > 0;
    const ttlMs = isHotProfile
      ? HOT_PROFILE_REFRESH_TTL_SECONDS * 1000
      : DRODO_FRESH_TTL_MS;
    const fetchedMs = initialDrodoLastFetchedAt
      ? new Date(initialDrodoLastFetchedAt).getTime()
      : NaN;
    if (Number.isFinite(fetchedMs) && Date.now() - fetchedMs < ttlMs) return;
    autoRefreshTriggered.current = true;

    let cancelled = false;
    let settled = false;
    setRefreshing(true);
    void (async () => {
      try {
        const resp = await fetch(`/api/drodo/${encodeURIComponent(steamId)}`);
        const data = await resp.json().catch(() => null);
        if (cancelled) return;
        if (resp.status === 404) {
          setDrodo(null);
          setDrodoProfileMissing(true);
          if (typeof data?.fetched_at === "string") {
            setDrodoLastFetchedAt(data.fetched_at);
          }
          return;
        }
        if (!resp.ok || !data) return;
        const profile = data as RefreshedDrodoProfile;
        setDrodo((current) => ({
          ...drodoStatsFromProfile(profile),
          queen_rank: profile.queen_rank ?? current?.queen_rank ?? null,
        }));
        if (Array.isArray(profile.seasons)) {
          setSeasons(profile.seasons as SeasonSnapshot[]);
        }
        if (Array.isArray(profile.mmr_history)) {
          setMmrHistory(profile.mmr_history.filter(isMmrSnapshot));
        }
        if (Array.isArray(profile.queen_rank_history)) {
          setQueenRankHistory(
            profile.queen_rank_history.filter(isQueenRankSnapshot)
          );
        }
        if (typeof profile.fetched_at === "string") {
          setDrodoLastFetchedAt(profile.fetched_at);
        }
      } catch {
        // Keep the cached stats; the manual Refresh button still works.
      } finally {
        settled = true;
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
      // React Strict Mode runs this effect, cleans it up, then runs it again.
      // If the request never settled, allow that second run. Once it has
      // settled, keep the one-shot so a history update cannot refetch forever.
      if (!settled) autoRefreshTriggered.current = false;
    };
  }, [
    steamId,
    initialDrodo,
    initialDrodoProfileMissing,
    initialDrodoLastFetchedAt,
    queenRankHistory,
  ]);

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
    });
  }, [
    games.length,
    initialDrodo?.mmr,
    initialSeasons.length,
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
      if (!data) {
        // No body to apply — fall back to a reload so the user still sees fresh
        // server-rendered stats.
        window.location.reload();
        return;
      }
      // Apply the freshly fetched profile to state directly. A reload would
      // re-serve this force-static page from the ISR cache (revalidate=300) and
      // show the same stale stats, so update in place like the auto-refresh does.
      const profile = data as RefreshedDrodoProfile;
      setDrodoProfileMissing(false);
      setDrodo((current) => ({
        ...drodoStatsFromProfile(profile),
        queen_rank: profile.queen_rank ?? current?.queen_rank ?? null,
      }));
      if (Array.isArray(profile.seasons)) {
        setSeasons(profile.seasons as SeasonSnapshot[]);
      }
      if (Array.isArray(profile.mmr_history)) {
        setMmrHistory(profile.mmr_history.filter(isMmrSnapshot));
      }
      if (Array.isArray(profile.queen_rank_history)) {
        setQueenRankHistory(
          profile.queen_rank_history.filter(isQueenRankSnapshot)
        );
      }
      if (typeof profile.fetched_at === "string") {
        setDrodoLastFetchedAt(profile.fetched_at);
      }
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
          {!DRODO_MMR_ENABLED && (
            <div className={styles.outageNotice} role="status">
              {DRODO_OUTAGE_NOTICE}
            </div>
          )}
          {(drodo?.mmr_level != null || drodo?.mmr != null) && (
            <div className={styles.rankLadder}>
              <RankLadder
                mmr={DRODO_MMR_ENABLED ? drodo.mmr : null}
                mmrLevel={drodo.mmr_level}
                queenRank={drodo.queen_rank}
              />
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
              </div>
            </div>
            <div className={styles.playerActions}>
              {DRODO_LIVE_FETCH_ENABLED ? (
                <Button disabled={refreshDisabled} onClick={handleRefresh}>
                  {!authReady
                    ? "Checking..."
                    : refreshing
                      ? "Refreshing..."
                      : "Refresh Stats"}
                </Button>
              ) : null}
              {DRODO_LIVE_FETCH_ENABLED && showQuota && (
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
              {DRODO_LIVE_FETCH_ENABLED && (
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
              )}
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
              <div className={styles.historyPanel}>
                <div className={styles.historyCard}>
                  {(historyTabs.length > 1 || mmrSeasonTabs.length > 1) && (
                    <div className={styles.historyHeader}>
                      {historyTabs.length > 1 && (
                        <div
                          className={styles.segmented}
                          role="tablist"
                          aria-label="Rating history"
                        >
                          {historyTabs.map((tab) => (
                            <button
                              key={tab.key}
                              type="button"
                              className={`${styles.segment} ${historyTab === tab.key ? styles.segmentActive : ""}`}
                              onClick={() => setHistoryTab(tab.key)}
                              role="tab"
                              aria-selected={historyTab === tab.key}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {historyTab === "mmr" && mmrSeasonTabs.length > 1 && (
                        <div className={styles.historyHeaderTools}>
                          <div
                            className={styles.segmented}
                            role="tablist"
                            aria-label="MMR history season"
                          >
                            {mmrSeasonTabs.map((tab) => (
                              <button
                                key={tab.key}
                                type="button"
                                className={`${styles.segment} ${mmrSeasonKey === tab.key ? styles.segmentActive : ""}`}
                                onClick={() => setMmrSeasonKey(tab.key)}
                                role="tab"
                                aria-selected={mmrSeasonKey === tab.key}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className={styles.historyTabPanel} role="tabpanel">
                    {historyTab === "queen" ? (
                      <QueenRankSparkline
                        snapshots={effectiveQueenRankHistory}
                      />
                    ) : (
                      <MmrSparkline
                        snapshots={effectiveMmrHistory}
                        activeSeasonKey={mmrSeasonKey}
                        queenRank={drodo?.queen_rank}
                      />
                    )}
                  </div>
                </div>
              </div>
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
