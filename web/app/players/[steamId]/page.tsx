import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { PlayerGame } from "@dac/shared/types";
import type { SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import type { MmrSnapshot } from "@/components/MmrSparkline";
import type { QueenRankSnapshot } from "@/components/QueenRankSparkline";
import { absoluteUrl, getSiteUrl } from "@/lib/site";
import { getManualRefreshQuota } from "@/lib/manualRefreshQuota";
import {
  fetchAndCacheDrodo,
  lastTop3FromDrodoData,
  lastWinFromDrodoData,
  type DrodoProfileRow,
} from "@/lib/drodo";
import { fetchSteamProfile } from "@/lib/steam";
import PlayerView, { type PlayerPageProps } from "@/components/player/PlayerView";
import {
  buildPlayerSeo,
  cachedSteamProfile,
  playerProfilePath,
  resolvePlayerRoute,
  USER_DRODO_SELECT,
  type CachedUserDrodoRow,
} from "@/components/player/playerData";

export const dynamic = "force-static";
export const revalidate = 300;

type LoadResult =
  | { kind: "notFound" }
  | { kind: "redirect"; destination: string }
  | { kind: "ok"; data: Omit<PlayerPageProps, "route"> };

function numberFromRawData(
  rawData: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  const value = rawData?.[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function drodoFromProfile(profile: DrodoProfileRow) {
  return {
    mmr: profile.mmr,
    max_mmr: profile.max_mmr,
    mmr_level: profile.mmr_level,
    queen_rank: profile.queen_rank,
    last_win_at: lastWinFromDrodoData(profile.raw_data),
    last_top3_at: lastTop3FromDrodoData(profile.raw_data),
    season: profile.season,
    season_games: profile.season_games,
    candy: profile.candy,
    chicken_count: profile.chicken_count,
  };
}

function drodoFromCachedRow(row: CachedUserDrodoRow) {
  return {
    mmr: row.drodo_mmr,
    max_mmr: row.drodo_max_mmr,
    mmr_level: row.drodo_mmr_level,
    queen_rank: numberFromRawData(row.drodo_raw_data, "queen_rank"),
    last_win_at: row.drodo_raw_data ? lastWinFromDrodoData(row.drodo_raw_data) : null,
    last_top3_at: row.drodo_raw_data ? lastTop3FromDrodoData(row.drodo_raw_data) : null,
    season: row.drodo_season,
    season_games: row.drodo_season_games,
    candy: row.drodo_candy,
    chicken_count: row.drodo_chicken_count,
  };
}

/** Cached per request so generateMetadata and the page render share data. */
const loadPlayer = cache(async (rawSteamId: string): Promise<LoadResult> => {
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return { kind: "notFound" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = url && key ? createClient(url, key) : null;

  const baseUrl = getSiteUrl();

  const resolved = await resolvePlayerRoute(rawSteamId, supabase);
  if (!resolved) {
    return { kind: "notFound" };
  }
  const { steamId } = resolved;
  const manualRefreshQuota = getManualRefreshQuota(undefined, Date.now(), {
    cadence: "public",
    target: steamId,
  });

  let cachedProfileRow: CachedUserDrodoRow | null = resolved.cachedProfileRow;

  let drodo = null;
  let drodoProfileMissing = false;
  let drodoLastFetchedAt = null;
  let seasons: SeasonSnapshot[] = [];
  let mmrHistory: MmrSnapshot[] = [];
  let queenRankHistory: QueenRankSnapshot[] = [];
  if (supabase) {
    const profilePromise = cachedProfileRow
      ? Promise.resolve({ data: cachedProfileRow })
      : supabase
          .from("users")
          .select(USER_DRODO_SELECT)
          .eq("steam_id", steamId)
          .maybeSingle<CachedUserDrodoRow>();

    const [profileResult, seasonsResult, snapshotsResult] = await Promise.all([
      profilePromise,
      supabase
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played, chicken_count")
        .eq("steam_id", steamId)
        .order("season", { ascending: true }),
      supabase
        .from("mmr_snapshots")
        .select("*")
        .eq("steam_id", steamId)
        .not("mmr", "is", null)
        .order("snapshotted_at", { ascending: false })
        .limit(60),
    ]);
    cachedProfileRow = profileResult.data ?? null;
    mmrHistory = (snapshotsResult.data ?? []).map((row) => ({
      mmr: row.mmr as number | null,
      snapshotted_at: row.snapshotted_at as string,
    }));
    queenRankHistory = (snapshotsResult.data ?? [])
      .map((row) => ({
        queen_rank: typeof row.queen_rank === "number" ? row.queen_rank : null,
        snapshotted_at: row.snapshotted_at as string,
      }))
      .filter((row) => row.queen_rank != null);
    if (profileResult.data) {
      drodoProfileMissing = Boolean(profileResult.data.drodo_profile_missing);
      drodoLastFetchedAt = profileResult.data.drodo_last_fetched_at;
      if (
        (profileResult.data.drodo_last_fetched_at ||
          profileResult.data.drodo_mmr != null) &&
        !drodoProfileMissing
      ) {
        drodo = drodoFromCachedRow(profileResult.data);
      }
    }
    if (seasonsResult.data) seasons = seasonsResult.data;

    if (!drodo && !drodoProfileMissing) {
      const initialDrodo = await fetchAndCacheDrodo(steamId, supabase, {
        snapshotOnSuccess: true,
        pollMode: "reset",
      });

      if (initialDrodo.ok) {
        drodo = drodoFromProfile(initialDrodo.profile);
        seasons = initialDrodo.seasonRows;
        drodoLastFetchedAt = initialDrodo.profile.fetched_at;
        drodoProfileMissing = false;
        mmrHistory = [
          {
            mmr: initialDrodo.profile.mmr,
            snapshotted_at: initialDrodo.profile.fetched_at,
          },
          ...mmrHistory,
        ];
        queenRankHistory = initialDrodo.profile.queen_rank == null
          ? queenRankHistory
          : [
              {
                queen_rank: initialDrodo.profile.queen_rank,
                snapshotted_at: initialDrodo.profile.fetched_at,
              },
              ...queenRankHistory,
            ];
      } else if (initialDrodo.kind === "missing") {
        drodoProfileMissing = true;
        drodoLastFetchedAt = initialDrodo.fetchedAt ?? null;
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

  const gamesPromise = supabase
    ? supabase
        .from("match_players")
        .select("*, steam_id::text")
        .eq("steam_id", steamId)
        .order("played_at", { ascending: false })
        .limit(100)
    : Promise.resolve({ data: [] as PlayerGame[] });

  const gamesResult = await gamesPromise;

  if (
    steamProfile.customUrl &&
    rawSteamId !== steamProfile.customUrl &&
    rawSteamId === steamId
  ) {
    return {
      kind: "redirect",
      destination: playerProfilePath(steamId, steamProfile.customUrl),
    };
  }

  // Map match_players rows → Game shape with legacy aliases for rendering.
  const games: PlayerGame[] = ((gamesResult.data as Record<string, unknown>[]) || []).map(
    (row) => ({
      ...row,
      user_id: String(row.steam_id),
      placement: row.placement != null ? String(row.placement) : "",
      played_at: (row.played_at as string) ?? "",
      created_at: (row.created_at as string) ?? "",
      lineup: row.chess_lineup as string | null,
      level: row.hero_level ? String(row.hero_level) : null,
      rank: null,
      rank_change: null,
      wl: null,
      wins: row.win_round as number | null,
      losses: row.lose_round as number | null,
      match_id: (row.match_id as string) ?? null,
    })
  ) as PlayerGame[];

  return {
    kind: "ok",
    data: {
      steamId,
      steamProfile,
      games,
      drodo,
      seasons,
      mmrHistory,
      queenRankHistory,
      leaderboardPosition: null,
      drodoProfileMissing,
      drodoLastFetchedAt,
      manualRefreshQuota,
      ogImageUrl: absoluteUrl(`/api/og/player/${steamId}`, baseUrl),
      canonicalUrl: absoluteUrl(
        playerProfilePath(steamId, steamProfile.customUrl),
        baseUrl
      ),
    },
  };
});

interface PageProps {
  params: Promise<{ steamId: string }>;
}

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { steamId } = await params;
  const result = await loadPlayer(steamId);
  if (result.kind !== "ok") return {};

  const seo = buildPlayerSeo(result.data);
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: seo.canonicalUrl ?? undefined },
    robots: "index, follow, max-image-preview:large",
    openGraph: {
      title: seo.title,
      description: seo.description,
      type: "profile",
      ...(seo.canonicalUrl ? { url: seo.canonicalUrl } : {}),
      ...(seo.ogImageUrl
        ? { images: [{ url: seo.ogImageUrl, alt: seo.imageAlt }] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.description,
      ...(seo.ogImageUrl ? { images: [seo.ogImageUrl] } : {}),
    },
  };
}

export default async function PlayerProfilePage({ params }: PageProps) {
  const { steamId } = await params;
  const result = await loadPlayer(steamId);

  if (result.kind === "redirect") redirect(result.destination);
  if (result.kind !== "ok") notFound();

  const { structuredData } = buildPlayerSeo(result.data);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <PlayerView route="/players/[steamId]" {...result.data} />
    </>
  );
}
