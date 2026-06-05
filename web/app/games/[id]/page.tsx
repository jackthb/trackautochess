import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { relicsData } from "@/generated/content-data";
import type { Game, RelicInfo } from "@dac/shared/types";
import { RANK_BRACKETS } from "@dac/shared/game-utils";
import { fetchSteamProfile, type SteamProfile } from "@/lib/steam";
import { absoluteUrl, getRequestSiteUrl } from "@/lib/site";
import GameView, {
  type GamePageProps,
  type MatchTimeline,
  type RelicTimelineEntry,
} from "@/components/game/GameView";
import { buildGameSeo, parseRelicHistory } from "@/components/game/gameData";

// App Router migration of pages/games/[id].tsx. The old getServerSideProps body
// lives here verbatim, wrapped in React cache() so generateMetadata and the page
// component share a single fetch per request. GamePage (now GameView) is a
// "use client" component in @/components/game/GameView.
export const dynamic = "force-dynamic";

function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank.replace("-", " ");
}

/** Map a raw match_players row into a Game with legacy aliases populated.
 *  Copied verbatim from the old pages/games/[id].tsx getServerSideProps. */
function mpRowToGame(
  mp: Record<string, unknown>,
  playedAtFallback?: string
): Game {
  const steamId = String(mp.steam_id ?? "");
  const played = (mp.played_at as string) || playedAtFallback || "";
  const mmrLevel = (mp.mmr_level as number) ?? null;
  const heroLevel = (mp.hero_level as number) ?? null;
  const winRound = (mp.win_round as number) ?? null;
  const loseRound = (mp.lose_round as number) ?? null;
  return {
    id: mp.id as number,
    match_id: (mp.match_id as string) ?? "",
    user_id: steamId,
    placement: mp.placement != null ? String(mp.placement) : "",
    lineup: (mp.chess_lineup as string) ?? null,
    synergies: (mp.synergies as string) ?? null,
    talents: (mp.talents as string) ?? null,
    relic: (mp.relic as string) ?? null,
    level: heroLevel != null ? String(heroLevel) : null,
    rank: mmrLevel ? mmrLevelToRank(mmrLevel) : null,
    rank_change: null,
    wins: winRound,
    losses: loseRound,
    wl: null,
    screenshot: (mp.screenshot as string) ?? null,
    notes: (mp.notes as string) ?? null,
    replay: (mp.replay as string) ?? null,
    played_at: played,
    created_at: (mp.created_at as string) ?? "",
  };
}

/** Single cached fetch shared between generateMetadata and the page render.
 *  Port of the deleted games getServerSideProps. Returns the full props object
 *  (minus `route`) or null when the row isn't found. */
const loadGame = cache(
  async (
    id: string,
    highlightUserId: string | null
  ): Promise<Omit<GamePageProps, "route"> | null> => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const hdrs = await headers();
    const baseUrl = getRequestSiteUrl({
      host: hdrs.get("host") ?? undefined,
      "x-forwarded-proto": hdrs.get("x-forwarded-proto") ?? undefined,
      "x-forwarded-host": hdrs.get("x-forwarded-host") ?? undefined,
    });

    if (!url || !key) return null;

    const supabase = createClient(url, key);
    const { data } = await supabase
      .from("match_players")
      .select("*, steam_id::text")
      .eq("id", id)
      .single();

    if (!data) return null;

    // Kick off the owner Steam profile fetch and the match players query in
    // parallel — both only depend on the single row already in hand.
    const ownerProfilePromise: Promise<SteamProfile> = data.steam_id
      ? fetchSteamProfile(String(data.steam_id), supabase)
      : Promise.resolve({ name: null, customUrl: null });

    const matchPlayersPromise: Promise<Record<string, unknown>[]> = data.match_id
      ? Promise.resolve(
          supabase
            .from("match_players")
            .select("*, steam_id::text")
            .eq("match_id", data.match_id)
            .order("placement", { ascending: true })
        ).then(({ data: matchData }) => (matchData as Record<string, unknown>[] | null) || [])
      : Promise.resolve([]);

    // Per-match round-by-round snapshots. Only nettable-captured matches
    // have a row here; CV-captured matches return null and the scrubber
    // is hidden client-side.
    const timelinePromise: Promise<MatchTimeline | null> = data.match_id
      ? Promise.resolve(
          supabase
            .from("match_timelines")
            .select("timeline")
            .eq("match_id", data.match_id)
            .maybeSingle()
        ).then(
          ({ data: row }) =>
            ((row as { timeline: MatchTimeline } | null)?.timeline) ?? null
        )
      : Promise.resolve(null);

    // played_at may be null on match_players; fall back to matches.played_at.
    const matchPlayedAtPromise: Promise<string> = data.match_id
      ? Promise.resolve(
          supabase
            .from("matches")
            .select("played_at")
            .eq("match_id", data.match_id)
            .maybeSingle()
        ).then(
          ({ data: row }) =>
            ((row as { played_at: string } | null)?.played_at) ?? ""
        )
      : Promise.resolve("");

    const [steamProfile, allPlayerRows, timeline, matchPlayedAt] =
      await Promise.all([
        ownerProfilePromise,
        matchPlayersPromise,
        timelinePromise,
        matchPlayedAtPromise,
      ]);

    const matchGames = allPlayerRows.map((row) => mpRowToGame(row, matchPlayedAt));
    const game = mpRowToGame(data, matchPlayedAt);

    // Build relic timelines directly from the match_players data we already have.
    const relicsMap = (relicsData as any).relics as Record<string, RelicInfo>;
    const relicTimelines: Record<string, RelicTimelineEntry[]> = {};
    for (const row of allPlayerRows) {
      const sid = String(row.steam_id);
      const tl = parseRelicHistory(row.relic_history, relicsMap);
      if (tl.length > 0) relicTimelines[sid] = tl;
    }

    const matchProfiles: Record<string, SteamProfile> = {};
    if (matchGames.length > 0) {
      const userIds = [
        ...new Set(matchGames.map((g) => g.user_id).filter(Boolean).map(String)),
      ];

      await Promise.all(
        userIds.map(async (uid) => {
          matchProfiles[uid] = await fetchSteamProfile(uid, supabase);
        })
      );
    }

    // Look up the highlighted user's Steam name. Game Over uploads often
    // can't link rows to a Steam account, so we also need to match by the
    // OCR'd player name stored in `notes`.
    let highlightName: string | null = null;
    if (highlightUserId) {
      if (matchProfiles[highlightUserId]?.name) {
        highlightName = matchProfiles[highlightUserId].name;
      } else {
        try {
          const profile = await fetchSteamProfile(highlightUserId, supabase, {
            persist: false,
          });
          highlightName = profile.name || null;
        } catch {
          highlightName = null;
        }
      }
    }

    return {
      game,
      steamProfile,
      matchGames,
      matchProfiles,
      relicTimelines,
      timeline,
      highlightUserId,
      highlightName,
      canonicalUrl: absoluteUrl(`/games/${id}`, baseUrl),
      ogImageUrl: absoluteUrl(`/api/og/game/${id}`, baseUrl),
    };
  }
);

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const sp = await searchParams;
  const player = typeof sp.player === "string" ? sp.player : null;
  const data = await loadGame(id, player);
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

export default async function GameDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const player = typeof sp.player === "string" ? sp.player : null;
  const data = await loadGame(id, player);
  if (!data) notFound();

  const { structuredData } = buildGameSeo(data);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <GameView route="/games/[id]" {...data} />
    </>
  );
}
