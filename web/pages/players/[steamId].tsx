import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import { absoluteUrl, getRequestSiteUrl, SITE_TITLE } from "@/lib/site";
import unitsData from "@data/units.json";
import unitsFullData from "@data/units_full.json";
import synergiesData from "@data/synergies.json";
import relicsData from "@data/relics.json";
import type { PlayerGame, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import { mmrToRank } from "@dac/shared/game-utils";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import { buildStatItems } from "@dac/shared/buildStatItems";
import { Button } from "@dac/shared/Button";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { SeasonHistoryGrid, type SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import {
  getManualRefreshQuota,
  type ManualRefreshQuota,
} from "@/lib/manualRefreshQuota";
import {
  fetchSteamProfile,
  playerProfilePath,
  resolveSteamInput,
  steamProfileUrl,
  type SteamProfile,
} from "../../lib/steam";

const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_DATA = synergiesData as Record<string, SynergyInfo>;
const RELICS_DATA = (relicsData as any).relics as Record<string, RelicInfo>;

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
  drodoProfileMissing: boolean;
  drodoLastFetchedAt: string | null;
  manualRefreshQuota: ManualRefreshQuota;
  ogImageUrl: string | null;
  twitchOgUrl: string | null;
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

export default function PlayerPage({
  steamId,
  steamProfile,
  games,
  drodo: initialDrodo,
  seasons: initialSeasons,
  drodoProfileMissing: initialDrodoProfileMissing,
  drodoLastFetchedAt: initialDrodoLastFetchedAt,
  manualRefreshQuota: initialManualRefreshQuota,
  ogImageUrl,
  twitchOgUrl,
  canonicalUrl,
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
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const displayName = steamProfile.name || steamProfile.customUrl || steamId;
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl);
  const title = `${displayName} | ${SITE_TITLE}`;
  const description = drodo?.mmr
    ? `${displayName} is ${mmrToRank(drodo.mmr)} at ${drodo.mmr.toLocaleString("en-US")} MMR.`
    : `Dota Auto Chess profile for ${displayName}.`;

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

  const lastFetchedTimestamp = formatLastFetchedTimestamp(drodoLastFetchedAt);
  const lastFetchedAge = formatLastFetchedAge(drodoLastFetchedAt, nowMs);
  const refreshDisabled = refreshing || manualRefreshQuota.remaining <= 0;
  const refreshQuotaLabel = `${manualRefreshQuota.remaining}/${manualRefreshQuota.limit}`;

  const handleRefresh = async () => {
    if (manualRefreshQuota.remaining <= 0) {
      setRefreshError("Daily manual refresh limit reached.");
      return;
    }

    setManualRefreshQuota((quota) => ({
      ...quota,
      used: Math.min(quota.limit, quota.used + 1),
      remaining: Math.max(0, quota.remaining - 1),
    }));
    setRefreshError(null);
    setRefreshing(true);
    try {
      const resp = await fetch(
        `/api/drodo/${encodeURIComponent(steamId)}?refresh=1`,
        { method: "POST" }
      );
      const data = await resp.json().catch(() => null);
      if (data?.refresh_quota) {
        setManualRefreshQuota(data.refresh_quota);
      }
      if (!resp.ok) {
        if (resp.status === 404) {
          setDrodoProfileMissing(true);
          setDrodo(null);
          if (typeof data?.fetched_at === "string") {
            setDrodoLastFetchedAt(data.fetched_at);
          }
        } else if (resp.status === 429) {
          setRefreshError("Daily manual refresh limit reached.");
        } else {
          setRefreshError(data?.error || "Refresh failed. Try again later.");
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
    } catch {
      setRefreshError("Refresh failed. Try again later.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="profile" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
        {ogImageUrl && <meta property="og:image" content={ogImageUrl} />}
        {ogImageUrl && <meta name="twitter:image" content={ogImageUrl} />}
      </Head>

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
              </div>
            </div>
            <div className="player-actions">
              <Button disabled={refreshDisabled} onClick={handleRefresh}>
                {refreshing ? "Refreshing..." : "Refresh MMR"}
              </Button>
              <div className="refresh-quota">
                <span>Manual refreshes</span>
                <span className="refresh-quota-value">
                  {refreshQuotaLabel} left today
                </span>
              </div>
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
                <a href={twitchOgUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.5px" }}>
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
                    <Link href={`/games/${g.id}`} style={{ display: "block", color: "inherit" }}>
                      <GameRowDisplay
                        game={g}
                        unitCosts={UNIT_COSTS}
                        unitsFull={UNITS_FULL}
                        synergiesData={SYNERGIES_DATA}
                        relicsData={RELICS_DATA}
                        iconUrl={(type, stem) => `/icons/${type}/${stem}.png`}
                        shareUrl={`/games/${g.id}`}
                      />
                    </Link>
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
  const supabase = url && key ? createClient(url, key) : null;
  const baseUrl = getRequestSiteUrl(context.req.headers);
  const manualRefreshQuota = getManualRefreshQuota(context.req.headers.cookie);

  // Accept numeric Steam IDs or vanity slugs. Keep vanity slugs in the URL
  // when present; they are the preferred public profile route.
  const steamId = await resolveSteamInput(rawSteamId, supabase ?? undefined, {
    persist: false,
  });
  if (!steamId) {
    return { notFound: true };
  }

  // Fetch cached Drodo profile and season history from public Supabase rows.
  let drodo = null;
  let drodoProfileMissing = false;
  let drodoLastFetchedAt = null;
  let seasons: SeasonSnapshot[] = [];
  if (supabase) {
    const [profileResult, seasonsResult] = await Promise.all([
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
    ]);
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
  }

  const steamProfile = await fetchSteamProfile(steamId, supabase ?? undefined, {
    persist: true,
    requireAvatar: true,
    requireCustomUrl: /^\d+$/.test(rawSteamId),
  });

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

  const gamesResult = supabase
    ? await supabase
        .from("games")
        .select("*, user_id::text")
        .in("user_id", profileUserIds)
        .order("played_at", { ascending: false })
    : { data: [] };

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

  return {
    props: {
      steamId,
      steamProfile,
      games: (gamesResult.data as PlayerGame[]) || [],
      drodo,
      seasons,
      drodoProfileMissing,
      drodoLastFetchedAt,
      manualRefreshQuota,
      ogImageUrl: absoluteUrl(`/api/og/player/${steamId}`, baseUrl),
      twitchOgUrl: absoluteUrl(`/api/og/twitch/${steamId}`, baseUrl),
      canonicalUrl: absoluteUrl(
        playerProfilePath(steamId, steamProfile.customUrl),
        baseUrl
      ),
    },
  };
};
