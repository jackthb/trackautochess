import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { GetServerSideProps } from "next";
import { absoluteUrl, getRequestSiteUrl, SITE_TITLE } from "@/lib/site";
import unitsData from "@data/units.json";
import type { PlayerGame } from "@dac/shared/types";
import { mmrToRank } from "@dac/shared/game-utils";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import { buildStatItems } from "@dac/shared/buildStatItems";
import { Button } from "@dac/shared/Button";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { SeasonHistoryGrid, type SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import { MmrSparkline, type MmrSnapshot } from "@/components/MmrSparkline";
import { RankLadder } from "@/components/RankLadder";
import { SeoHead } from "@/lib/seo";
import {
  getManualRefreshQuota,
  type ManualRefreshQuota,
} from "@/lib/manualRefreshQuota";
import { isAdminSteamId } from "@/lib/admin";
import { analyticsRoute, bucketCount, trackEvent } from "@/lib/analytics";
import { fetchAndCacheDrodo } from "@/lib/drodo";
import {
  fetchSteamProfile,
  parseSteamInput,
  playerProfilePath,
  resolveSteamInput,
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";

const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}
for (const [alias, canonical] of Object.entries(
  (unitsData as { aliases?: Record<string, string> }).aliases ?? {}
)) {
  if (UNIT_COSTS[canonical] !== undefined) {
    UNIT_COSTS[alias] = UNIT_COSTS[canonical];
  }
}
const USER_DRODO_SELECT = [
  "name",
  "custom_url",
  "avatar_url",
  "banned",
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_mmr_level",
  "drodo_season",
  "drodo_season_games",
  "drodo_candy",
  "drodo_chicken_count",
  "drodo_last_fetched_at",
  "drodo_profile_missing",
].join(", ");
const LAST_FETCHED_TICK_MS = 1000;

interface CachedUserDrodoRow {
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  banned: boolean | null;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number | null;
  drodo_last_fetched_at: string | null;
  drodo_profile_missing: boolean | null;
}

interface LeaderboardPosition {
  rank: number;
  total: number;
}

interface PlayerPageProps {
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
  twitchOgUrl: string | null;
  canonicalUrl: string | null;
  banned: boolean;
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

function originFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function localIconUrl(type: string, stem: string): string {
  return `/icons/${type}/${stem}.png`;
}

async function resolvePlayerRouteSteamId(
  rawSteamId: string,
  supabase: SupabaseClient | null
): Promise<string | null> {
  const parsed = parseSteamInput(rawSteamId);
  if (!parsed) return null;
  if (parsed.kind === "id") return parsed.value;

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("steam_id::text")
      .eq("custom_url", parsed.value)
      .eq("banned", false)
      .maybeSingle<{ steam_id: string }>();

    if (data?.steam_id) return String(data.steam_id);
  }

  return resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
}

function cachedSteamProfile(
  row: CachedUserDrodoRow | null | undefined,
  options: { requireAvatar: boolean; requireCustomUrl: boolean }
): SteamProfile | null {
  if (!row) return null;

  const profile = {
    name: row.name ?? null,
    customUrl: row.custom_url ?? null,
    avatarUrl: row.avatar_url ?? null,
  };
  const hasProfile = profile.name || profile.customUrl || profile.avatarUrl;
  if (!hasProfile) return null;
  if (options.requireAvatar && !profile.avatarUrl) return null;
  if (options.requireCustomUrl && !profile.customUrl) return null;

  return profile;
}

export default function PlayerPage({
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
  ogImageUrl,
  twitchOgUrl,
  canonicalUrl,
  banned: initialBanned,
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
  const [banned, setBanned] = useState(initialBanned);
  const [banPending, setBanPending] = useState(false);
  const [banError, setBanError] = useState<string | null>(null);

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
  const playerPath = playerProfilePath(steamId, steamProfile.customUrl);
  const title = `${displayName} | ${SITE_TITLE}`;
  const description = drodo?.mmr
    ? `${displayName} is ${mmrToRank(drodo.mmr)} at ${drodo.mmr.toLocaleString("en-US")} MMR.`
    : `Dota Auto Chess profile for ${displayName}.`;
  const structuredDataBase = originFromUrl(canonicalUrl);
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      name: title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      about: {
        "@type": "Person",
        name: displayName,
        sameAs: profileUrl,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Track Auto Chess",
          ...(structuredDataBase ? { item: `${structuredDataBase}/` } : {}),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: displayName,
          ...(canonicalUrl ? { item: canonicalUrl } : {}),
        },
      ],
    },
  ];

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
      route: analyticsRoute(router.pathname),
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
    router.pathname,
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
        route: analyticsRoute(router.pathname),
        reason: "not_allowed",
      });
      setRefreshError("Sign in with Steam to refresh your own profile.");
      return;
    }
    if (showQuota && manualRefreshQuota.remaining <= 0) {
      trackEvent("Player Refresh Blocked", {
        route: analyticsRoute(router.pathname),
        reason: "quota",
      });
      setRefreshError("Daily manual refresh limit reached.");
      return;
    }

    trackEvent("Player Refresh Started", {
      route: analyticsRoute(router.pathname),
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
          route: analyticsRoute(router.pathname),
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
        route: analyticsRoute(router.pathname),
        has_mmr: data.mmr != null,
        has_seasons: Array.isArray(data.seasons),
        quota_bucket: data?.refresh_quota
          ? bucketCount(data.refresh_quota.remaining)
          : "unknown",
      });
    } catch (error) {
      trackEvent("Player Refresh Failed", {
        route: analyticsRoute(router.pathname),
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

  const handleToggleBan = async () => {
    if (!isAdmin) return;
    const next = !banned;
    if (
      next &&
      !window.confirm(`Ban ${displayName}? They will be hidden from the site and signed out.`)
    ) {
      return;
    }
    setBanError(null);
    setBanPending(true);
    try {
      const resp = await fetch("/api/admin/ban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ steam_id: steamId, banned: next }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setBanError(data?.error || `Request failed (HTTP ${resp.status}).`);
        return;
      }
      setBanned(Boolean(data?.banned));
    } catch (error) {
      const detail =
        error instanceof Error && error.message ? ` (${error.message})` : "";
      setBanError(`Ban request failed${detail}.`);
    } finally {
      setBanPending(false);
    }
  };

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path={playerPath}
        localized={false}
        type="profile"
        canonicalUrl={canonicalUrl}
        imageUrl={ogImageUrl}
        imageAlt={`${displayName} Auto Chess profile stats`}
        structuredData={structuredData}
      />

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
          {banned && (
            <div
              style={{
                marginBottom: 24,
                padding: "12px 16px",
                border: "1px solid var(--accent)",
                borderRadius: "var(--r-3)",
                background: "var(--bg-surface)",
                color: "var(--accent)",
                fontSize: 13,
                letterSpacing: "0.4px",
              }}
            >
              This player is banned. They are hidden from the public site and
              blocked from signing in. Only admins see this page.
            </div>
          )}
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
              {isAdmin && (
                <Button disabled={banPending} onClick={handleToggleBan}>
                  {banPending
                    ? banned
                      ? "Unbanning..."
                      : "Banning..."
                    : banned
                      ? "Unban player"
                      : "Ban player"}
                </Button>
              )}
              {banError && <div className="refresh-error">{banError}</div>}
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
              {twitchOgUrl && (
                <a
                  href={twitchOgUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.5px" }}
                  onClick={() =>
                    trackEvent("Twitch Overlay Link Clicked", {
                      route: analyticsRoute(router.pathname),
                    })
                  }
                >
                  Twitch overlay link ↗
                </a>
              )}
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
                {games.map((g) => (
                  <div key={g.id} className="game-entry">
                    <div
                      className="game-row-link"
                      role="link"
                      tabIndex={0}
                      onClick={() => router.push(`/games/${g.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/games/${g.id}`);
                        }
                      }}
                    >
                      <GameRowDisplay
                        game={g}
                        unitCosts={UNIT_COSTS}
                        iconUrl={localIconUrl}
                        shareUrl={`/games/${g.id}`}
                        style={{ cursor: "pointer" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { steamId: rawSteamId } = context.params!;
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return { notFound: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = url && key ? createClient(url, key) : null;
  const supabaseAdmin =
    url && serviceKey
      ? createClient(url, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;
  const baseUrl = getRequestSiteUrl(context.req.headers);
  const manualRefreshQuota = getManualRefreshQuota(context.req.headers.cookie);

  let viewerSteamId: string | null = null;
  if (url && key) {
    try {
      const ssrSupabase = createServerClient(url, key, {
        cookies: {
          getAll() {
            return Object.entries(context.req.cookies).map(([name, value]) => ({
              name,
              value: value ?? "",
            }));
          },
          setAll() {
            // Read-only for SSR; we don't need to write cookies here.
          },
        },
      });
      const { data } = await ssrSupabase.auth.getUser();
      const meta = data.user?.user_metadata as
        | { steam_id?: unknown }
        | null
        | undefined;
      if (meta && typeof meta.steam_id === "string") {
        viewerSteamId = meta.steam_id;
      }
    } catch {
      viewerSteamId = null;
    }
  }
  const viewerIsAdmin = isAdminSteamId(viewerSteamId);

  // Accept numeric Steam IDs or vanity slugs. Keep vanity slugs in the URL
  // when present; they are the preferred public profile route.
  const steamId = await resolvePlayerRouteSteamId(rawSteamId, supabase);
  if (!steamId) {
    return { notFound: true };
  }

  let banned = false;
  let cachedProfileRow: CachedUserDrodoRow | null = null;

  // Fetch cached Drodo profile and season history from public Supabase rows.
  let drodo = null;
  let drodoProfileMissing = false;
  let drodoLastFetchedAt = null;
  let seasons: SeasonSnapshot[] = [];
  let mmrHistory: MmrSnapshot[] = [];
  if (supabase) {
    const [profileResult, seasonsResult, snapshotsResult] = await Promise.all([
      supabase
        .from("users")
        .select(USER_DRODO_SELECT)
        .eq("steam_id", steamId)
        .maybeSingle<CachedUserDrodoRow>(),
      supabase
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played, chicken_count")
        .eq("steam_id", steamId)
        .order("season", { ascending: true }),
      supabase
        .from("mmr_snapshots")
        .select("mmr, snapshotted_at")
        .eq("steam_id", steamId)
        .not("mmr", "is", null)
        .order("snapshotted_at", { ascending: false })
        .limit(60),
    ]);
    cachedProfileRow = profileResult.data ?? null;
    banned = Boolean(cachedProfileRow?.banned);
    if (banned && !viewerIsAdmin) {
      return { notFound: true };
    }
    mmrHistory = (snapshotsResult.data ?? []).map((row) => ({
      mmr: row.mmr as number | null,
      snapshotted_at: row.snapshotted_at as string,
    }));
    if (profileResult.data) {
      drodoProfileMissing = Boolean(profileResult.data.drodo_profile_missing);
      drodoLastFetchedAt = profileResult.data.drodo_last_fetched_at;
      if (profileResult.data.drodo_last_fetched_at && !drodoProfileMissing) {
        drodo = {
          mmr: profileResult.data.drodo_mmr,
          max_mmr: profileResult.data.drodo_max_mmr,
          mmr_level: profileResult.data.drodo_mmr_level,
          season: profileResult.data.drodo_season,
          season_games: profileResult.data.drodo_season_games,
          candy: profileResult.data.drodo_candy,
          chicken_count: profileResult.data.drodo_chicken_count,
        };
      }
    }
    if (seasonsResult.data) seasons = seasonsResult.data;

    // First-time profile view: kick off a Drodo pull so the page lands
    // with data instead of an empty MMR card. The cooldown logic in
    // fetchAndCacheDrodo + isFreshCache prevents repeat pulls.
    if (drodoLastFetchedAt === null && supabaseAdmin) {
      const result = await fetchAndCacheDrodo(steamId, supabaseAdmin);
      if (result.ok) {
        drodo = {
          mmr: result.profile.mmr,
          max_mmr: result.profile.max_mmr,
          mmr_level: result.profile.mmr_level,
          season: result.profile.season,
          season_games: result.profile.season_games,
          candy: result.profile.candy,
          chicken_count: result.profile.chicken_count,
        };
        drodoProfileMissing = false;
        drodoLastFetchedAt = result.profile.fetched_at;
        const { data: refreshedSeasons } = await supabaseAdmin
          .from("player_seasons")
          .select("season, mmr, max_mmr, games_played, chicken_count")
          .eq("steam_id", steamId)
          .order("season", { ascending: true });
        if (refreshedSeasons) seasons = refreshedSeasons;
      } else if (result.kind === "missing") {
        drodoProfileMissing = true;
        drodoLastFetchedAt = result.fetchedAt ?? new Date().toISOString();
      }
    }
  }

  const profileRequirements = {
    requireAvatar: true,
    requireCustomUrl: /^\d+$/.test(rawSteamId),
  };
  const steamProfile =
    cachedSteamProfile(cachedProfileRow, profileRequirements) ??
    (await fetchSteamProfile(steamId, supabase ?? undefined, {
      persist: true,
      ...profileRequirements,
    }));

  let profileUserIds = [steamId];
  if (supabase) {
    const vanityKeys = [
      steamProfile.customUrl,
      !/^\d+$/.test(rawSteamId) ? rawSteamId : null,
    ].filter(Boolean) as string[];

    if (vanityKeys.length > 0) {
      const { data: vanityUsers } = await supabase
        .from("users")
        .select("steam_id::text")
        .in("custom_url", [...new Set(vanityKeys)]);

      const vanityIds = (vanityUsers ?? [])
        .map((row) => String(row.steam_id))
        .filter(Boolean);
      profileUserIds = [...new Set([steamId, ...vanityIds])];
    }
  }

  // Fetch the player's games list and leaderboard position concurrently;
  // both are independent of each other and dominate the SSR latency.
  const gamesPromise = supabase
    ? supabase
        .from("games")
        .select("*, user_id::text")
        .in("user_id", profileUserIds)
        .order("played_at", { ascending: false })
        .limit(100)
    : Promise.resolve({ data: [] as PlayerGame[] });

  const leaderboardPromise: Promise<LeaderboardPosition | null> =
    supabase && drodo?.mmr != null
      ? Promise.all([
          supabase
            .from("users")
            .select("steam_id", { count: "exact", head: true })
            .not("drodo_last_fetched_at", "is", null)
            .eq("drodo_profile_missing", false)
            .eq("banned", false)
            .gt("drodo_mmr", drodo.mmr),
          supabase
            .from("users")
            .select("steam_id", { count: "exact", head: true })
            .not("drodo_last_fetched_at", "is", null)
            .eq("drodo_profile_missing", false)
            .eq("banned", false)
            .not("drodo_mmr", "is", null),
        ]).then(([{ count: higherCount }, { count: totalRanked }]) =>
          typeof higherCount === "number" && typeof totalRanked === "number"
            ? { rank: higherCount + 1, total: totalRanked }
            : null
        )
      : Promise.resolve(null);

  const [gamesResult, leaderboardPosition] = await Promise.all([
    gamesPromise,
    leaderboardPromise,
  ]);

  if (
    steamProfile.customUrl &&
    rawSteamId !== steamProfile.customUrl &&
    rawSteamId === steamId
  ) {
    return {
      redirect: {
        destination: playerProfilePath(steamId, steamProfile.customUrl),
        permanent: false,
      },
    };
  }

  if (!viewerSteamId && !banned) {
    context.res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=3600"
    );
  }

  return {
    props: {
      steamId,
      steamProfile,
      games: (gamesResult.data as PlayerGame[]) || [],
      drodo,
      seasons,
      mmrHistory,
      leaderboardPosition,
      drodoProfileMissing,
      drodoLastFetchedAt,
      manualRefreshQuota,
      ogImageUrl: absoluteUrl(`/api/og/player/${steamId}`, baseUrl),
      twitchOgUrl: absoluteUrl(`/api/og/twitch/${steamId}`, baseUrl),
      canonicalUrl: absoluteUrl(
        playerProfilePath(steamId, steamProfile.customUrl),
        baseUrl
      ),
      banned,
    },
  };
};
