"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { UNIT_COSTS } from "@/lib/units";
import type { PlayerGame } from "@dac/shared/types";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import { buildStatItems } from "@dac/shared/buildStatItems";
import { Button } from "@dac/shared/Button";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { SeasonHistoryGrid, type SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import { MmrSparkline, type MmrSnapshot } from "@/components/MmrSparkline";
import { RankLadder } from "@/components/RankLadder";
import { type ManualRefreshQuota } from "@/lib/manualRefreshQuota";
import { isAdminSteamId } from "@/lib/admin";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import { resolveIconUrl } from "@/lib/icons";
import {
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";

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
    season: string | null;
    season_games: number | null;
    candy: number | null;
    chicken_count: number | null;
  } | null;
  seasons: SeasonSnapshot[];
  mmrHistory: MmrSnapshot[];
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

export default function PlayerView({
  route,
  steamId,
  steamProfile,
  games,
  drodo: initialDrodo,
  seasons: initialSeasons,
  mmrHistory,
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
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [sessionSteamId, setSessionSteamId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void import("@/lib/supabase").then(({ createSupabaseClient }) => {
      if (cancelled) return;
      const supabase = createSupabaseClient();
      if (!supabase) return;

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

  const lastFetchedTimestamp = formatLastFetchedTimestamp(drodoLastFetchedAt);
  const lastFetchedAge = formatLastFetchedAge(drodoLastFetchedAt, nowMs);
  const showQuota = canRefresh && !isAdmin;
  const refreshDisabled =
    !canRefresh ||
    refreshing ||
    (showQuota && manualRefreshQuota.remaining <= 0);
  const refreshQuotaLabel = `${manualRefreshQuota.remaining}/${manualRefreshQuota.limit}`;

  const handleRefresh = async () => {
    if (!canRefresh) {
      trackEvent("Player Refresh Blocked", {
        route: analyticsRoute(route),
        reason: "not_allowed",
      });
      setRefreshError("Sign in with Steam to refresh your own profile.");
      return;
    }
    if (showQuota && manualRefreshQuota.remaining <= 0) {
      trackEvent("Player Refresh Blocked", {
        route: analyticsRoute(route),
        reason: "quota",
      });
      setRefreshError("Daily manual refresh limit reached.");
      return;
    }

    trackEvent("Player Refresh Started", {
      route: analyticsRoute(route),
      is_admin: isAdmin,
      is_own_profile: isOwnProfile,
      quota_bucket: bucketCount(manualRefreshQuota.remaining),
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
          setRefreshError("Daily manual refresh limit reached.");
        } else if (resp.status === 403) {
          setRefreshError("Refresh blocked by anti-bot verification.");
        } else {
          setRefreshError(
            data?.error || `Refresh failed with HTTP ${resp.status}.`
          );
        }
        return;
      }

      setDrodoProfileMissing(false);
      setDrodo({
        mmr: data.mmr ?? null,
        max_mmr: data.max_mmr ?? null,
        mmr_level: data.mmr_level ?? null,
        season: data.season ?? null,
        season_games: data.season_games ?? null,
        candy: data.candy ?? null,
        chicken_count: data.chicken_count ?? null,
      });
      if (typeof data.fetched_at === "string") {
        setDrodoLastFetchedAt(data.fetched_at);
      }
      if (Array.isArray(data.seasons)) setSeasons(data.seasons);
      trackEvent("Player Refresh Succeeded", {
        route: analyticsRoute(route),
        has_mmr: data.mmr != null,
        has_seasons: Array.isArray(data.seasons),
        quota_bucket: data?.refresh_quota
          ? bucketCount(data.refresh_quota.remaining)
          : "unknown",
      });
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
    <>
      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .dashboard {
          max-width: 1200px;
          margin: 0 auto;
          padding: 32px 32px 72px;
          position: relative;
        }
        .rank-ladder {
          position: absolute;
          top: 32px;
          left: -176px;
          width: 156px;
        }
        @media (max-width: 1552px) {
          .rank-ladder {
            display: none;
          }
        }
        .player-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 24px;
        }
        .player-identity {
          display: flex;
          align-items: center;
          gap: 18px;
          min-width: 0;
        }
        .player-avatar {
          width: 72px;
          height: 72px;
          flex-shrink: 0;
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          background: var(--bg-surface);
          object-fit: cover;
        }
        .player-avatar-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 30px;
          font-weight: var(--fw-bold);
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .player-heading { min-width: 0; }
        .player-name {
          font-family: "Cinzel", serif;
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }
        .player-meta {
          font-size: 13px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
        .player-meta a {
          color: var(--text-muted);
          transition: color 0.15s;
        }
        .player-meta a:hover {
          color: var(--text-secondary);
        }
        .leaderboard-rank {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          margin-top: 8px;
          padding: 4px 10px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-3);
          letter-spacing: 0.6px;
        }
        .leaderboard-rank a {
          color: var(--text-secondary);
          text-decoration: none;
        }
        .leaderboard-rank a:hover {
          color: var(--text-primary);
        }
        .leaderboard-rank-num {
          color: var(--text-primary);
          font-weight: 600;
        }
        .leaderboard-rank-total {
          color: var(--text-muted);
        }
        .player-actions {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          flex-shrink: 0;
        }
        .last-fetched {
          display: grid;
          gap: 3px;
          text-align: right;
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.4px;
        }
        .last-fetched-label {
          text-transform: uppercase;
          letter-spacing: 1.2px;
        }
        .last-fetched-value,
        .last-fetched-age {
          font-family: var(--font-mono), ui-monospace, SFMono-Regular, Consolas,
            "Liberation Mono", monospace;
        }
        .last-fetched-value {
          color: var(--text-secondary);
        }
        .refresh-quota {
          display: grid;
          gap: 3px;
          text-align: right;
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.4px;
        }
        .refresh-quota-value {
          font-family: var(--font-mono), ui-monospace, SFMono-Regular, Consolas,
            "Liberation Mono", monospace;
          color: var(--text-secondary);
        }
        .refresh-error {
          max-width: 220px;
          text-align: right;
          font-size: 11px;
          color: var(--accent);
          letter-spacing: 0.35px;
        }
        .table-wrap {
          border: 1px solid var(--border);
          overflow: hidden;
        }
        .table-header {
          display: grid;
          grid-template-columns: 72px 1fr 120px 80px 60px 120px 100px;
          padding: 0 20px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border);
        }
        .th {
          font-size: 13px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 14px 6px;
        }
        .game-entry {
          border-bottom: 1px solid var(--border-subtle);
        }
        .game-entry:last-child {
          border-bottom: none;
        }
        .game-row-link {
          display: block;
          color: inherit;
          cursor: pointer;
        }
        .game-row-link:focus-visible {
          outline: 1px solid var(--accent);
          outline-offset: -1px;
        }
        .empty-state {
          text-align: center;
          padding: 80px 32px;
          color: var(--text-muted);
          font-size: 16px;
          background: var(--bg-surface);
        }
        @media (max-width: 620px) {
          .player-header {
            flex-direction: column;
          }
          .player-identity {
            align-items: flex-start;
          }
          .player-actions,
          .last-fetched,
          .refresh-quota,
          .refresh-error {
            align-items: flex-start;
            text-align: left;
          }
        }
      `}</style>

      <div className="page">
        <div className="dashboard">
          {drodo?.mmr != null && (
            <div className="rank-ladder">
              <RankLadder mmr={drodo.mmr} />
            </div>
          )}
          <div className="player-header">
            <div className="player-identity">
              {steamProfile.avatarUrl && !avatarFailed ? (
                <img
                  className="player-avatar"
                  src={steamProfile.avatarUrl}
                  alt={`${displayName} Steam avatar`}
                  width={72}
                  height={72}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <div className="player-avatar player-avatar-fallback" aria-hidden="true">
                  {displayName.charAt(0) || "?"}
                </div>
              )}
              <div className="player-heading">
                <div className="player-name">{displayName}</div>
                <div className="player-meta">
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
                  <div className="leaderboard-rank">
                    <a href="/leaderboard">
                      Rank{" "}
                      <span className="leaderboard-rank-num">
                        #{leaderboardPosition.rank}
                      </span>{" "}
                      <span className="leaderboard-rank-total">
                        of {leaderboardPosition.total}
                      </span>
                    </a>
                  </div>
                )}
              </div>
            </div>
            <div className="player-actions">
              {canRefresh && (
                <Button disabled={refreshDisabled} onClick={handleRefresh}>
                  {refreshing ? "Refreshing..." : "Refresh MMR"}
                </Button>
              )}
              {showQuota && (
                <div className="refresh-quota">
                  <span>Manual refreshes</span>
                  <span className="refresh-quota-value">
                    {refreshQuotaLabel} left today
                  </span>
                </div>
              )}
              {refreshError && (
                <div className="refresh-error">{refreshError}</div>
              )}
              <div className="last-fetched">
                <span className="last-fetched-label">Last fetched</span>
                <time
                  className="last-fetched-value"
                  dateTime={drodoLastFetchedAt ?? undefined}
                >
                  {lastFetchedTimestamp}
                </time>
                {lastFetchedAge && (
                  <span className="last-fetched-age">{lastFetchedAge}</span>
                )}
              </div>
            </div>
          </div>

          {drodoProfileMissing && !drodo && (
            <div className="table-wrap" style={{ marginBottom: 32 }}>
              <div className="empty-state">
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

          <MmrSparkline seasons={seasons} snapshots={mmrHistory} />

          <SeasonHistoryGrid seasons={seasons} />

          {games.length > 0 && (
            <>
              <div className="section-title">Matches</div>
              <div className="table-wrap">
                <div className="table-header">
                  <div className="th">#</div>
                  <div className="th">Lineup</div>
                  <div className="th">Rank</div>
                  <div className="th">W &ndash; L</div>
                  <div className="th">Lv</div>
                  <div className="th">Relic</div>
                  <div className="th">Date</div>
                </div>
                {games.map((g) => {
                  const href = `/matches/${g.id}`;
                  return (
                    <div key={g.id} className="game-entry">
                      <div
                        className="game-row-link"
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
    </>
  );
}
