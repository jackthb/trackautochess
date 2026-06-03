"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { UNIT_COSTS } from "@/lib/units";
import relicsJson from "@data/relics.json";
import type { PlayerGame, RelicInfo } from "@dac/shared/types";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import { buildStatItems } from "@dac/shared/buildStatItems";
import { Button } from "@dac/shared/Button";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { SeasonHistoryGrid, type SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import { MmrSparkline, type MmrSnapshot } from "@/components/MmrSparkline";
import { QueenRankSparkline, type QueenRankSnapshot } from "@/components/QueenRankSparkline";
import { RankLadder } from "@/components/RankLadder";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import {
  getManualRefreshQuota,
  type ManualRefreshQuota,
} from "@/lib/manualRefreshQuota";
import { isAdminSteamId } from "@/lib/admin";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import { resolveIconUrl } from "@/lib/icons";
import {
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";
import styles from "./PlayerView.module.css";

const LAST_FETCHED_TICK_MS = 1000;
const ANONYMOUS_PROFILE_SEEN_KEY = "dac.anonymous_profile_seen";
const ANONYMOUS_RETURN_PROMPT_KEY = "dac.anonymous_return_prompt_seen";

// item_* id → relic display info, so the match-history rows can render the
// full relic_history pick list (not just the single active `relic`).
const RELICS_MAP = (relicsJson as { relics?: Record<string, RelicInfo> }).relics ?? {};

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


function formatRefreshReset(value: string | null, nowMs: number | null): string {
  if (!value || nowMs == null) return "available this hour";

  const resetMs = new Date(value).getTime();
  if (!Number.isFinite(resetMs) || resetMs <= nowMs) return "available now";

  const totalSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `available in ${seconds}s`;

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
          deltas are now reserved for logged-in Steam users.
        </p>
        <SteamTrustNote source="player_history_lock" />
      </div>
      <div className={styles.historyLockedAction}>
        <SteamSignInButton source="player_history_lock" size="md" />
      </div>
    </section>
  );
}

function SteamTrustNote({ source }: { source: string }) {
  return (
    <details
      className={styles.steamTrustNote}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          trackEvent("Steam Sign In Reassurance Expanded", { source });
        }
      }}
    >
      <summary>
        <span className={styles.steamTrustIcon} aria-hidden="true">i</span>
        Worried about Steam sign-in?
      </summary>
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
    </details>
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
  const router = useRouter();
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
  const [showReturnPrompt, setShowReturnPrompt] = useState(false);

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
  const canViewHistory = authReady && sessionSteamId !== null;
  const canRefresh = isAdmin || isOwnProfile;
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
    setManualRefreshQuota(getManualRefreshQuota(document.cookie));
  }, []);

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
    if (!authReady) return;
    if (sessionSteamId) {
      setShowReturnPrompt(false);
      return;
    }

    const hasVisitedBefore = window.localStorage.getItem(ANONYMOUS_PROFILE_SEEN_KEY) === "1";
    const hasSeenPrompt = window.localStorage.getItem(ANONYMOUS_RETURN_PROMPT_KEY) === "1";
    window.localStorage.setItem(ANONYMOUS_PROFILE_SEEN_KEY, "1");

    if (hasVisitedBefore && !hasSeenPrompt) {
      setShowReturnPrompt(true);
      window.localStorage.setItem(ANONYMOUS_RETURN_PROMPT_KEY, "1");
      trackEvent("Returning Anonymous Prompt Viewed", {
        route: analyticsRoute(route),
      });
    }
  }, [authReady, route, sessionSteamId]);

  useEffect(() => {
    if (!authReady || canViewHistory) return;
    trackEvent("Player History Locked Viewed", {
      route: analyticsRoute(route),
    });
  }, [authReady, canViewHistory, route]);

  const dismissReturnPrompt = () => {
    setShowReturnPrompt(false);
    trackEvent("Returning Anonymous Prompt Dismissed", {
      route: analyticsRoute(route),
    });
  };

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
  const showQuota = canRefresh && !isAdmin;
  const refreshDisabled =
    !canRefresh ||
    refreshing ||
    (showQuota && effectiveManualRefreshQuota.remaining <= 0);
  const refreshQuotaLabel = `${effectiveManualRefreshQuota.remaining}/${effectiveManualRefreshQuota.limit}`;
  const refreshQuotaResetLabel = formatRefreshReset(
    effectiveManualRefreshQuota.reset_at,
    nowMs
  );

  const handleRefresh = async () => {
    if (!canRefresh) {
      trackEvent("Player Refresh Blocked", {
        route: analyticsRoute(route),
        reason: "not_allowed",
      });
      setRefreshError("Sign in with Steam to refresh your own profile.");
      return;
    }
    if (showQuota && effectiveManualRefreshQuota.remaining <= 0) {
      trackEvent("Player Refresh Blocked", {
        route: analyticsRoute(route),
        reason: "quota",
      });
      setRefreshError("Hourly manual refresh limit reached.");
      return;
    }

    trackEvent("Player Refresh Started", {
      route: analyticsRoute(route),
      is_admin: isAdmin,
      is_own_profile: isOwnProfile,
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
          setRefreshError("Hourly manual refresh limit reached.");
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
      {showReturnPrompt && (
        <div className={styles.returnPrompt} role="dialog" aria-live="polite" aria-label="Sign in reminder">
          <div className={styles.returnPromptPanel}>
            <button
              type="button"
              className={styles.returnPromptClose}
              onClick={dismissReturnPrompt}
              aria-label="Dismiss sign in reminder"
            >
              ×
            </button>
            <div className={styles.returnPromptEyebrow}>Welcome back</div>
            <h2>Log in once to keep your Auto Chess history unlocked.</h2>
            <p>
              We remember you have visited before, but not which Steam profile is yours.
              Sign in to unlock MMR graphs, season history, and session deltas.
            </p>
            <SteamTrustNote source="returning_anonymous_prompt" />
            <SteamSignInButton source="returning_anonymous_prompt" size="md" />
          </div>
        </div>
      )}
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
              {canRefresh && (
                <Button disabled={refreshDisabled} onClick={handleRefresh}>
                  {refreshing ? "Refreshing..." : "Refresh MMR"}
                </Button>
              )}
              {showQuota && (
                <div className={styles.refreshQuota}>
                  <span>Manual refreshes</span>
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
              <div className={styles.tableWrap}>
                <div className={styles.tableHeader}>
                  <div className={styles.th}>#</div>
                  <div className={styles.th}>Lineup</div>
                  <div className={styles.th}>Rank</div>
                  <div className={styles.th}>W &ndash; L</div>
                  <div className={styles.th}>Lv</div>
                  <div className={styles.th}>Relic</div>
                  <div className={styles.th}>Date</div>
                </div>
                {games.map((g) => {
                  const href = `/matches/${g.id}`;
                  return (
                    <div key={g.id} className={styles.gameEntry}>
                      <div
                        className={styles.gameRowLink}
                        role="link"
                        tabIndex={0}
                        onClick={() => router.push(href)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(href);
                          }
                        }}
                      >
                        <GameRowDisplay
                          game={g}
                          unitCosts={UNIT_COSTS}
                          relicsData={RELICS_MAP}
                          iconUrl={resolveIconUrl}
                          shareUrl={href}
                          style={{ cursor: "pointer" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
  );
}
