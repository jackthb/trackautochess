import type { Metadata } from "next";
import { cache } from "react";
import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import type { PlayerGame, UnitFullInfo } from "@dac/shared/types";
import type { SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import { mmrLevelToRank, parseSynergies } from "@dac/shared/game-utils";
import {
  buildChessCodeUnitLookup,
  resolveChessLineup,
} from "@dac/shared/game-structure";
import type { MmrSnapshot } from "@/components/MmrSparkline";
import type { QueenRankSnapshot } from "@/components/QueenRankSparkline";
import { absoluteUrl, getSiteUrl } from "@/lib/site";
import { getManualRefreshQuota } from "@/lib/manualRefreshQuota";
import {
  HOT_PROFILE_REFRESH_TTL_SECONDS,
  isFreshCache,
  lastTop3FromDrodoData,
  lastWinFromDrodoData,
  numberFromDrodoData,
} from "@/lib/drodo";
import { readThroughDrodoProfile } from "@/lib/drodoReadThrough";
import { mostRecentTimestamp } from "@/lib/timestamps";
import { fetchSteamProfile } from "@/lib/steam";
import PlayerView, { type PlayerPageProps } from "@/components/player/PlayerView";
import {
  buildPlayerSeo,
  cachedSteamProfile,
  drodoStatsFromProfile,
  playerProfilePath,
  resolvePlayerRoute,
  USER_DRODO_SELECT,
  type CachedUserDrodoRow,
} from "@/components/player/playerData";
import { createSupabaseServerClient } from "@/lib/supabase";
import { unitsFullData } from "@/generated/content-data";
import { computeSynergies } from "@/lib/units";

const CHESS_CODE_UNITS = buildChessCodeUnitLookup(
  unitsFullData as Record<string, UnitFullInfo>
);

export const dynamic = "force-static";
export const revalidate = 300;

type LoadResult =
  | { kind: "notFound" }
  | { kind: "redirect"; destination: string }
  | { kind: "ok"; data: Omit<PlayerPageProps, "route"> };

function drodoFromCachedRow(row: CachedUserDrodoRow) {
  return {
    mmr: row.drodo_mmr,
    max_mmr: row.drodo_max_mmr,
    mmr_level: row.drodo_mmr_level,
    queen_rank:
      row.queen_ladder_rank ??
      (row.drodo_raw_data ? numberFromDrodoData(row.drodo_raw_data, "queen_rank") : null),
    last_win_at: row.drodo_raw_data ? lastWinFromDrodoData(row.drodo_raw_data) : null,
    last_top3_at: row.drodo_raw_data ? lastTop3FromDrodoData(row.drodo_raw_data) : null,
    season: row.drodo_season,
    season_games: row.drodo_season_games,
    candy: row.drodo_candy,
    chicken_count: row.drodo_chicken_count,
  };
}

function isCachedQueenProfile(row: CachedUserDrodoRow | null): boolean {
  return Boolean(
    row?.queen_ladder_rank != null ||
      row?.queen_ladder_last_seen_at ||
      (row?.drodo_raw_data && numberFromDrodoData(row.drodo_raw_data, "queen_rank") != null)
  );
}

function isHotCacheFresh(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return false;
  const fetchedTime = new Date(fetchedAt).getTime();
  if (!Number.isFinite(fetchedTime)) return false;
  return Date.now() - fetchedTime < HOT_PROFILE_REFRESH_TTL_SECONDS * 1000;
}

const PLAYER_DUPLICATE_WINDOW_MS = 90 * 60 * 1000;

function playerHistoryDuplicateKey(row: Record<string, unknown>): string {
  const playedAt = typeof row.played_at === "string" ? row.played_at : "";
  const playedAtMs = new Date(playedAt).getTime();
  const bucket = Number.isFinite(playedAtMs)
    ? Math.floor(playedAtMs / PLAYER_DUPLICATE_WINDOW_MS)
    : 0;
  return [
    bucket,
    row.steam_id ?? "",
    row.placement ?? "",
    row.chess_lineup ?? "",
    row.synergies ?? "",
    row.relic ?? "",
    row.win_round ?? "",
    row.lose_round ?? "",
  ].join("::");
}

function dedupePlayerHistoryRows(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const bySignature = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = playerHistoryDuplicateKey(row);
    const current = bySignature.get(key);
    const rowId = typeof row.id === "number" ? row.id : 0;
    const currentId = typeof current?.id === "number" ? current.id : 0;
    if (!current || rowId > currentId) {
      bySignature.set(key, row);
    }
  }
  return [...bySignature.values()].sort((a, b) => {
    const aTime = typeof a.played_at === "string" ? a.played_at : "";
    const bTime = typeof b.played_at === "string" ? b.played_at : "";
    return bTime.localeCompare(aTime);
  });
}

function serializeResolvedLineup(lineup: { name: string; stars: number }[]): string {
  return lineup
    .map((unit) => `${unit.name}${unit.stars > 1 ? `(${unit.stars})` : ""}`)
    .join("|");
}

function serializeComputedSynergies(
  synergies: { name: string; count: number }[]
): string {
  return synergies.map((synergy) => `${synergy.name}:${synergy.count}`).join("|");
}

/** Cached per request so generateMetadata and the page render share data. */
const loadPlayer = cache(async (rawSteamId: string): Promise<LoadResult> => {
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return { kind: "notFound" };
  }

  const supabase = createSupabaseServerClient();

  const baseUrl = getSiteUrl();

  const resolved = await resolvePlayerRoute(rawSteamId, supabase);
  if (!resolved) {
    return { kind: "notFound" };
  }
  const { steamId } = resolved;

  // Short-circuit the id→vanity redirect using the custom_url we already have,
  // before any heavy loading (Supabase queries, Steam/Drodo fetches). Visiting
  // by numeric Steam ID otherwise paid a full ~1.5s render just to compute the
  // redirect target. The cold case (no cached custom_url) still falls through to
  // the late redirect below once a fresh Steam profile is fetched.
  const cachedCustomUrl = resolved.cachedProfileRow?.custom_url ?? null;
  if (
    /^\d+$/.test(rawSteamId) &&
    rawSteamId === steamId &&
    cachedCustomUrl &&
    cachedCustomUrl !== rawSteamId
  ) {
    return {
      kind: "redirect",
      destination: playerProfilePath(steamId, cachedCustomUrl),
    };
  }

  let manualRefreshQuota = getManualRefreshQuota(undefined, Date.now(), {
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
  let gamesRows: Record<string, unknown>[] = [];
  let shouldRefreshDrodo = false;
  let hotProfilePoll = false;
  if (supabase) {
    const profilePromise = cachedProfileRow
      ? Promise.resolve({ data: cachedProfileRow })
      : supabase
          .from("users")
          .select(USER_DRODO_SELECT)
          .filter("steam_id", "eq", steamId)
          .maybeSingle<CachedUserDrodoRow>();

    const [profileResult, seasonsResult, snapshotsResult, gamesResult] = await Promise.all([
      profilePromise,
      supabase
        .from("player_seasons")
        .select("season, mmr, max_mmr, games_played, chicken_count")
        .filter("steam_id", "eq", steamId)
        .order("season", { ascending: true }),
      supabase
        .from("mmr_snapshots")
        .select("*")
        .filter("steam_id", "eq", steamId)
        .not("mmr", "is", null)
        .order("snapshotted_at", { ascending: false })
        .limit(60),
      supabase
        .from("match_players")
        .select("*, steam_id::text")
        .filter("steam_id", "eq", steamId)
        .order("played_at", { ascending: false })
        .limit(100),
    ]);
    gamesRows = (gamesResult.data as Record<string, unknown>[]) ?? [];
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
      drodoLastFetchedAt = mostRecentTimestamp(
        profileResult.data.drodo_last_fetched_at,
        profileResult.data.queen_ladder_last_seen_at
      );
      hotProfilePoll = isCachedQueenProfile(profileResult.data);
      if (hotProfilePoll) {
        manualRefreshQuota = getManualRefreshQuota(undefined, Date.now(), {
          cadence: "owner",
          target: steamId,
        });
      }
      shouldRefreshDrodo = hotProfilePoll && !drodoProfileMissing
        ? !isHotCacheFresh(drodoLastFetchedAt)
        : !isFreshCache(
            profileResult.data.drodo_last_fetched_at,
            drodoProfileMissing
          );
      if (
        (profileResult.data.drodo_last_fetched_at ||
          profileResult.data.drodo_mmr != null) &&
        !drodoProfileMissing
      ) {
        drodo = drodoFromCachedRow(profileResult.data);
      }
    } else {
      shouldRefreshDrodo = true;
    }
    if (seasonsResult.data) seasons = seasonsResult.data;

    // When cached stats exist, serve them immediately even if stale —
    // PlayerView refreshes from Drodo in the background with a loading state
    // (via GET /api/drodo, which re-checks freshness server-side). Only block
    // the render when there is nothing cached to show.
    if (shouldRefreshDrodo && !drodo) {
      const initialDrodo = await readThroughDrodoProfile({
        steamId,
        supabase,
        snapshotOnSuccess: true,
        pollMode: cachedProfileRow ? "adaptive" : "reset",
        hotPoll: hotProfilePoll,
      });

      if (initialDrodo.kind === "profile") {
        if (cachedProfileRow?.queen_ladder_rank != null) {
          manualRefreshQuota = getManualRefreshQuota(undefined, Date.now(), {
            cadence: "owner",
            target: steamId,
          });
        }
        drodo = {
          ...drodoStatsFromProfile(initialDrodo.payload),
          queen_rank: cachedProfileRow?.queen_ladder_rank ?? null,
        };
        seasons = initialDrodo.payload.seasons;
        drodoLastFetchedAt = mostRecentTimestamp(
          initialDrodo.payload.fetched_at,
          cachedProfileRow?.queen_ladder_last_seen_at
        );
        drodoProfileMissing = false;
        mmrHistory = [
          {
            mmr: initialDrodo.payload.mmr,
            snapshotted_at: initialDrodo.payload.fetched_at,
          },
          ...mmrHistory,
        ];
        queenRankHistory = cachedProfileRow?.queen_ladder_rank == null
          ? queenRankHistory
          : [
              {
                queen_rank: cachedProfileRow.queen_ladder_rank,
                snapshotted_at: initialDrodo.payload.fetched_at,
              },
              ...queenRankHistory,
            ];
      } else if (initialDrodo.kind === "missing") {
        drodoProfileMissing = true;
        drodoLastFetchedAt = mostRecentTimestamp(
          initialDrodo.fetched_at,
          cachedProfileRow?.queen_ladder_last_seen_at
        );
      }
    }
  }

  // A cached display name is enough to render the page. Blocking on the Steam
  // community XML fetch just to fill a missing avatar or discover a vanity URL
  // added ~0.5–2s to cold renders — and players with no vanity URL can never
  // satisfy requireCustomUrl from cache, so their numeric pages paid the fetch
  // on every revalidation. Refresh those fields after the response is sent;
  // the next render (and its id→vanity redirect) picks them up from the cache.
  const profileRequirements = {
    requireAvatar: true,
    requireCustomUrl: /^\d+$/.test(rawSteamId),
  };
  let steamProfile = cachedSteamProfile(cachedProfileRow, {
    requireAvatar: false,
    requireCustomUrl: false,
  });
  if (!steamProfile?.name && !steamProfile?.customUrl) {
    steamProfile = await fetchSteamProfile(steamId, supabase ?? undefined, {
      persist: true,
      ...profileRequirements,
    });
  } else if (!cachedSteamProfile(cachedProfileRow, profileRequirements)) {
    after(() =>
      fetchSteamProfile(steamId, supabase ?? undefined, {
        persist: true,
        ...profileRequirements,
      }).catch(() => {})
    );
  }

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
  const games: PlayerGame[] = dedupePlayerHistoryRows(gamesRows).map(
    (row) => {
      const resolvedLineup = resolveChessLineup(
        row.chess_lineup as string | undefined,
        CHESS_CODE_UNITS
      );
      const lineup = resolvedLineup.length
        ? serializeResolvedLineup(resolvedLineup)
        : (row.chess_lineup as string | null);
      const synergies = resolvedLineup.length
        ? serializeComputedSynergies(
            computeSynergies(
              resolvedLineup,
              parseSynergies(row.synergies as string | null)
            )
          )
        : (row.synergies as string | null);
      return {
        ...row,
        user_id: String(row.steam_id),
        placement: row.placement != null ? String(row.placement) : "",
        played_at: (row.played_at as string) ?? "",
        created_at: (row.created_at as string) ?? "",
        lineup,
        synergies,
        level: row.hero_level ? String(row.hero_level) : null,
        rank:
          typeof row.mmr_level === "number"
            ? mmrLevelToRank(row.mmr_level) || null
            : null,
        rank_change: null,
        wl: null,
        wins: row.win_round as number | null,
        losses: row.lose_round as number | null,
        match_id: (row.match_id as string) ?? null,
      };
    }
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
  // Hourly patch-note commits redeploy the site, and each deploy wipes the
  // ISR cache — every player page restarts cold. Prerender the top ladder at
  // build time so the most-visited profiles are warm immediately after each
  // deploy; everyone else stays on-demand.
  const supabase = createSupabaseServerClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("users")
    .select("steam_id::text, custom_url")
    .not("drodo_mmr", "is", null)
    .not("drodo_last_fetched_at", "is", null)
    .eq("drodo_profile_missing", false)
    .order("drodo_mmr", { ascending: false })
    .limit(100);

  return (data ?? []).map((row) => ({
    steamId: String(row.custom_url || row.steam_id),
  }));
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
