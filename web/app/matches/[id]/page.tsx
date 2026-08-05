import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { parseRelicHistory, type RelicTimelineEntry } from "@dac/shared/game-utils";
import { parseSteamId64 } from "@dac/shared/steam";
import { fetchSteamProfile, type SteamProfile } from "@/lib/steam";
import { absoluteUrl, getRequestSiteUrl } from "@/lib/site";
import { createSupabaseAnonClient } from "@/lib/supabase";
import { getRelicsMap } from "@/lib/relics";
import {
  fetchMatchPlayer,
  fetchMatchRoster,
  matchPlayerToGame,
} from "@/lib/matches";
import GameView, {
  type GamePageProps,
  type MatchTimeline,
} from "@/components/game/GameView";
import { buildGameSeo } from "@/components/game/gameData";
import { JsonLd } from "@/lib/structuredData";

export const dynamic = "force-dynamic";

interface MatchMetaRow {
  played_at: string;
  capture_status: string | null;
  is_finished: boolean | null;
  verification_source: string | null;
}

/** Single cached fetch shared between generateMetadata and the page render.
 *  Port of the deleted matches getServerSideProps. */
const loadMatch = cache(
  async (rawId: string): Promise<Omit<GamePageProps, "route"> | null> => {
    if (!/^\d+$/.test(rawId)) return null;
    const matchPlayerId = Number(rawId);
    if (!Number.isSafeInteger(matchPlayerId)) return null;

    const hdrs = await headers();
    const baseUrl = getRequestSiteUrl({
      host: hdrs.get("host") ?? undefined,
      "x-forwarded-proto": hdrs.get("x-forwarded-proto") ?? undefined,
      "x-forwarded-host": hdrs.get("x-forwarded-host") ?? undefined,
    });
    const supabase = createSupabaseAnonClient();
    if (!supabase) return null;

    const mp = await fetchMatchPlayer(supabase, matchPlayerId);
    if (!mp) return null;
    const focusSteamId = parseSteamId64(String(mp.steam_id));

    // Fetch all players in this match + the match metadata in parallel.
    const [players, { data: matchRow }, steamProfile, timelineResult] =
      await Promise.all([
        fetchMatchRoster(supabase, mp.match_id),
        supabase
          .from("matches")
          .select("played_at, capture_status, is_finished, verification_source")
          .eq("match_id", mp.match_id)
          .maybeSingle(),
        focusSteamId
          ? fetchSteamProfile(focusSteamId, supabase)
          : Promise.resolve({ name: null, customUrl: null, avatarUrl: null }),
        supabase
          .from("match_timelines")
          .select("timeline")
          .eq("match_id", mp.match_id)
          .maybeSingle(),
      ]);

    const matchMeta = matchRow as MatchMetaRow | null;
    const playedAt = matchMeta?.played_at || "";

    // Stamp played_at from the matches table onto each player row.
    for (const p of players) {
      if (!p.played_at) p.played_at = playedAt;
    }
    if (!mp.played_at) mp.played_at = playedAt;

    const matchGames = players.map(matchPlayerToGame);
    const game = matchPlayerToGame(mp);

    const relicsMap = getRelicsMap();
    const relicTimelines: Record<string, RelicTimelineEntry[]> = {};
    for (const p of players) {
      const sid = String(p.steam_id);
      const tl = parseRelicHistory(p.relic_history, relicsMap);
      if (tl.length > 0) relicTimelines[sid] = tl;
    }

    // Fetch Steam profiles for all players in parallel.
    const matchProfiles: Record<string, SteamProfile> = {};
    const steamIds = [...new Set(players.map((p) => String(p.steam_id)))];
    await Promise.all(
      steamIds.map(async (sid) => {
        const steamId = parseSteamId64(sid);
        matchProfiles[sid] = steamId
          ? await fetchSteamProfile(steamId, supabase)
          : { name: null, customUrl: null, avatarUrl: null };
      })
    );

    const timeline: MatchTimeline | null =
      ((timelineResult.data as { timeline: MatchTimeline } | null)?.timeline) ??
      null;

    return {
      game,
      steamProfile,
      matchGames,
      matchProfiles,
      relicTimelines,
      timeline,
      highlightUserId: String(mp.steam_id),
      highlightName: steamProfile.name || null,
      canonicalUrl: absoluteUrl(`/matches/${rawId}`, baseUrl),
      ogImageUrl: absoluteUrl(`/api/og/match/${rawId}`, baseUrl),
    };
  }
);

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await loadMatch(id);
  if (!data) return {};

  const seo = buildGameSeo(data);
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: seo.canonicalUrl ?? undefined },
    robots: "index, follow, max-image-preview:large",
    openGraph: {
      title: seo.title,
      description: seo.description,
      type: "article",
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

export default async function MatchDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadMatch(id);
  if (!data) notFound();

  const { structuredData } = buildGameSeo(data);

  return (
    <>
      <JsonLd data={structuredData} />
      <GameView route="/matches/[id]" {...data} />
    </>
  );
}
