import type { Metadata } from "next";
import { cache } from "react";
import { after } from "next/server";
import { notFound } from "next/navigation";
import type { PlayerGame } from "@dac/shared/types";
import type { SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import type { MmrSnapshot } from "@/components/MmrSparkline";
import type { QueenRankSnapshot } from "@/components/QueenRankSparkline";
import { absoluteUrl, getSiteUrl } from "@/lib/site";
import { getManualRefreshQuota } from "@/lib/manualRefreshQuota";
import {
  drodoStatsFromCachedRow,
  isCachedQueenProfile,
  isFreshCache,
  isHotCacheFresh,
} from "@/lib/drodo";
import { loadDrodoHistory, readThroughDrodoProfile } from "@/lib/drodoReadThrough";
import { DRODO_LIVE_FETCH_ENABLED } from "@/lib/drodoLive";
import {
  fetchPlayerHistoryRows,
  playerHistoryToGames,
} from "@/lib/playerHistory";
import { mostRecentTimestamp } from "@/lib/timestamps";
import { fetchSteamProfile } from "@/lib/steam";
import PlayerView, { type PlayerPageProps } from "@/components/player/PlayerView";
import {
  buildPlayerSeo,
  cachedSteamProfile,
  drodoStatsFromProfile,
  playerProfilePath,
  resolvePlayerRoute,
  PLAYER_PROFILE_DRODO_SELECT,
  type PlayerProfileDrodoRow,
} from "@/components/player/playerData";
import { createSupabaseServerClient } from "@/lib/supabase";

// Rendered dynamically (live DB read per request) instead of ISR-cached. With
// force-static + revalidate=300 a hard reload served the prerendered page until
// the timer/revalidation rebuilt it, so the queen rank (and other fields) lagged
// even after the data changed. Cached Drodo stats are still served immediately
// from the DB row and refreshed in the background by PlayerView, so a live read
// stays fast.
export const dynamic = "force-dynamic";

type LoadResult =
  | { kind: "notFound" }
  | { kind: "ok"; data: Omit<PlayerPageProps, "route"> };

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

  let manualRefreshQuota = getManualRefreshQuota(undefined, Date.now(), {
    cadence: "public",
    target: steamId,
  });

  let cachedProfileRow: PlayerProfileDrodoRow | null = resolved.cachedProfileRow;

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
          .select(PLAYER_PROFILE_DRODO_SELECT)
          .filter("steam_id", "eq", steamId)
          .maybeSingle<PlayerProfileDrodoRow>();

    const [profileResult, history, historyRows] = await Promise.all([
      profilePromise,
      loadDrodoHistory(supabase, steamId),
      fetchPlayerHistoryRows(supabase, steamId),
    ]);
    gamesRows = historyRows;
    cachedProfileRow = profileResult.data ?? null;
    mmrHistory = history.mmr_history;
    queenRankHistory = history.queen_rank_history;
    seasons = history.seasons;
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
      // Any cached rank material is enough to render. Gating on
      // drodo_last_fetched_at/drodo_mmr alone hid the rank of every row whose
      // only Drodo data is a level or a Queen-ladder placement — which, with
      // numeric MMR gone, is most of them.
      if (
        (profileResult.data.drodo_last_fetched_at ||
          profileResult.data.drodo_mmr != null ||
          profileResult.data.drodo_mmr_level != null ||
          profileResult.data.queen_ladder_rank != null) &&
        !drodoProfileMissing
      ) {
        drodo = drodoStatsFromCachedRow(profileResult.data);
      }
    } else {
      shouldRefreshDrodo = true;
    }

    // When cached stats exist, serve them immediately even if stale —
    // PlayerView refreshes from Drodo in the background with a loading state
    // (via GET /api/drodo, which re-checks freshness server-side). Only block
    // the render when there is nothing cached to show.
    if (DRODO_LIVE_FETCH_ENABLED && shouldRefreshDrodo && !drodo) {
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
            season: initialDrodo.payload.season,
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
  // added ~0.5–2s to cold renders. Refresh those fields after the response is
  // sent; the next render can use them for display and canonical metadata.
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

  // Dedupe duplicate uploads and map match_players rows → Game render shape.
  const games: PlayerGame[] = playerHistoryToGames(gamesRows);

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
