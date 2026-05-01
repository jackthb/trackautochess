import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { GetServerSideProps } from "next";
import { absoluteUrl, getRequestSiteUrl, SITE_TITLE } from "@/lib/site";
import unitsData from "@data/units.json";
import type { PlayerGame } from "@dac/shared/types";
import { mmrToRank } from "@dac/shared/game-utils";
import { buildStatItems } from "@dac/shared/buildStatItems";
import { Button } from "@dac/shared/Button";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { SeasonHistoryGrid, type SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import {
  fetchSteamProfile,
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
const DRODO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  supabase?: SupabaseClient | null;
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
  forceRefresh: boolean;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
}

export default function PlayerPage({
  steamId,
  steamProfile,
  games,
  drodo: initialDrodo,
  seasons: initialSeasons,
  drodoProfileMissing: initialDrodoProfileMissing,
  drodoLastFetchedAt: initialDrodoLastFetchedAt,
  forceRefresh,
  ogImageUrl,
  canonicalUrl,
  supabase,
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
  const [refreshing, setRefreshing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const displayName = steamProfile.name || steamProfile.customUrl || steamId;
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl);
  const title = `${displayName} | ${SITE_TITLE}`;
  const description = drodo?.mmr
    ? `${displayName} is ${mmrToRank(drodo.mmr)} at ${drodo.mmr.toLocaleString("en-US")} MMR.`
    : `Dota Auto Chess profile for ${displayName}.`;

  const { drodo: drodoItems } = useMemo(
    () => buildStatItems(games, drodo),
    [games, drodo]
  );

  // TODO: ingest total matches / avg rank / wins / preferred lineup / max damage from history pages for server-side season snapshots.
  useEffect(() => {
    setAvatarFailed(false);
  }, [steamProfile.avatarUrl]);


  useEffect(() => {
    const fetchedTime = drodoLastFetchedAt
      ? new Date(drodoLastFetchedAt).getTime()
      : NaN;
    const hasFreshCache =
      Number.isFinite(fetchedTime) &&
      Date.now() - fetchedTime < DRODO_CACHE_TTL_MS;
    if (!forceRefresh && hasFreshCache) return;

    let cancelled = false;
    fetch(`/api/drodo/${encodeURIComponent(steamId)}`)
      .then(async (resp) => {
        const data = await resp.json().catch(() => null);
        if (resp.ok) return data;
        if (resp.status === 404 && !cancelled) {
          setDrodoProfileMissing(true);
          if (typeof data?.fetched_at === "string") {
            setDrodoLastFetchedAt(data.fetched_at);
          }
        }
        return null;
      })
      .then((data) => {
        if (!data || cancelled) return;
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
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [drodoLastFetchedAt, forceRefresh, steamId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const resp = await fetch(
        `/api/drodo/${encodeURIComponent(steamId)}?refresh=1`,
        { method: "POST" }
      );
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        if (resp.status === 404) {
          setDrodoProfileMissing(true);
          setDrodo(null);
          if (typeof data?.fetched_at === "string") {
            setDrodoLastFetchedAt(data.fetched_at);
          }
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
                  {drodo && drodo.mmr != null && (
                    <>
                      {" \u00B7 "}
                      {mmrToRank(drodo.mmr)}
                    </>
                  )}
                </div>
              </div>
            </div>
            <Button
              disabled={refreshing}
              onClick={handleRefresh}
            >
              {refreshing ? "Refreshing..." : "Refresh MMR"}
            </Button>
          </div>

          {drodoProfileMissing && !drodo && (
            <div className="table-wrap" style={{ marginBottom: 32 }}>
              <div className="empty-state">
                No public Auto Chess stats found for this Steam profile.
              </div>
            </div>
          )}

          {drodoItems.length > 0 && (
            <>
              <div className="section-title">Auto Chess</div>
              <StatsGrid items={drodoItems} />
            </>
          )}

          <SeasonHistoryGrid seasons={seasons} />
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
  // Only honour ?refresh=1 when the request came from within the site.
  // Direct hits (bots, curl, shared links) have no same-origin Referer, so we
  // silently ignore the parameter rather than burning upstream API quota.
  const host = context.req.headers.host ?? "";
  const referer = context.req.headers.referer ?? "";
  const isSameOriginReferer = host.length > 0 && referer.includes(host);
  const forceRefresh = isSameOriginReferer && context.query.refresh === "1";
  const supabase = url && key ? createClient(url, key) : null;
  const baseUrl = getRequestSiteUrl(context.req.headers);

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
        .select("season, mmr, max_mmr, games_played")
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
        destination: `${playerProfilePath(steamId, steamProfile.customUrl)}${
          forceRefresh ? "?refresh=1" : ""
        }`,
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
      forceRefresh,
      ogImageUrl: absoluteUrl(`/api/og/player/${steamId}`, baseUrl),
      canonicalUrl: absoluteUrl(
        playerProfilePath(steamId, steamProfile.customUrl),
        baseUrl
      ),
    },
  };
};
