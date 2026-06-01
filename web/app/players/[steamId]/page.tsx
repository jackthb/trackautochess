import type { Metadata } from "next";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { PlayerGame } from "@dac/shared/types";
import type { SeasonSnapshot } from "@dac/shared/SeasonHistoryGrid";
import type { MmrSnapshot } from "@/components/MmrSparkline";
import { absoluteUrl, getRequestSiteUrl } from "@/lib/site";
import { getManualRefreshQuota } from "@/lib/manualRefreshQuota";
import { fetchAndCacheDrodo } from "@/lib/drodo";
import { fetchSteamProfile } from "@/lib/steam";
import PlayerView, {
  type LeaderboardPosition,
  type PlayerPageProps,
} from "@/components/player/PlayerView";
import {
  buildPlayerSeo,
  cachedSteamProfile,
  playerProfilePath,
  resolvePlayerRouteSteamId,
  USER_DRODO_SELECT,
  type CachedUserDrodoRow,
} from "@/components/player/playerData";

// App Router migration of pages/players/[steamId].tsx. The old getServerSideProps
// body lives here verbatim, wrapped in React cache() so generateMetadata and the
// page share one fetch per request. PlayerPage (now PlayerView) is a "use client"
// component in @/components/player/PlayerView.
export const dynamic = "force-dynamic";

type LoadResult =
  | { kind: "notFound" }
  | { kind: "redirect"; destination: string }
  | { kind: "ok"; data: Omit<PlayerPageProps, "route"> };

/** Single cached fetch shared between generateMetadata and the page render.
 *  Port of the deleted players getServerSideProps. Returns a discriminated
 *  result so the page can mirror the old notFound / redirect / props branches. */
const loadPlayer = cache(async (rawSteamId: string): Promise<LoadResult> => {
  if (!rawSteamId || typeof rawSteamId !== "string") {
    return { kind: "notFound" };
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

  const hdrs = await headers();
  const baseUrl = getRequestSiteUrl({
    host: hdrs.get("host") ?? undefined,
    "x-forwarded-proto": hdrs.get("x-forwarded-proto") ?? undefined,
    "x-forwarded-host": hdrs.get("x-forwarded-host") ?? undefined,
  });
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const manualRefreshQuota = getManualRefreshQuota(cookieHeader);

  let viewerSteamId: string | null = null;
  if (url && key) {
    try {
      const ssrSupabase = createServerClient(url, key, {
        cookies: {
          getAll() {
            return cookieStore.getAll().map(({ name, value }) => ({
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
  // viewerSteamId previously gated a per-request Cache-Control header in
  // getServerSideProps. App Router server components can't set response
  // headers, and `dynamic = "force-dynamic"` already opts out of caching, so
  // we keep the auth read (harmless) but drop the cache-header branch.
  void viewerSteamId;

  // Accept numeric Steam IDs or vanity slugs. Keep vanity slugs in the URL
  // when present; they are the preferred public profile route.
  const steamId = await resolvePlayerRouteSteamId(rawSteamId, supabase);
  if (!steamId) {
    return { kind: "notFound" };
  }

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

  // Fetch the player's match_players rows and leaderboard position concurrently;
  // both are independent of each other and dominate the SSR latency.
  const gamesPromise = supabase
    ? supabase
        .from("match_players")
        .select("*, steam_id::text")
        .in("steam_id", profileUserIds)
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
            .gt("drodo_mmr", drodo.mmr),
          supabase
            .from("users")
            .select("steam_id", { count: "exact", head: true })
            .not("drodo_last_fetched_at", "is", null)
            .eq("drodo_profile_missing", false)
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
      leaderboardPosition,
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
