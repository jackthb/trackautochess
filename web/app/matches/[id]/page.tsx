import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import relicsData from "@data/relics.json";
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

// App Router migration of pages/matches/[id].tsx. The old getServerSideProps
// body lives here verbatim, wrapped in React cache() so generateMetadata and
// the page share one fetch per request. Renders the shared GameView client
// component (formerly the GamePage from pages/games/[id].tsx).
export const dynamic = "force-dynamic";

function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank.replace("-", " ");
}

interface MatchMetaRow {
  played_at: string;
  capture_status: string | null;
  is_finished: boolean | null;
  verification_source: string | null;
}

interface MatchPlayerRow {
  id: number;
  match_id: string;
  steam_id: string | number;
  placement: number | null;
  mmr_level: number | null;
  hero_level: number | null;
  chess_lineup: string | null;
  synergies: string | null;
  talents: string | null;
  relic: string | null;
  relic_history: unknown;
  win_round: number | null;
  lose_round: number | null;
  played_at: string | null;
}

function mpToGame(mp: MatchPlayerRow): Game {
  return {
    id: mp.id,
    match_id: mp.match_id,
    user_id: String(mp.steam_id),
    placement: mp.placement != null ? String(mp.placement) : "",
    lineup: mp.chess_lineup,
    synergies: mp.synergies,
    talents: mp.talents,
    relic: mp.relic,
    level: mp.hero_level != null ? String(mp.hero_level) : null,
    rank: mp.mmr_level ? mmrLevelToRank(mp.mmr_level) : null,
    rank_change: null,
    wins: mp.win_round,
    losses: mp.lose_round,
    wl: null,
    screenshot: null,
    notes: null,
    replay: null,
    played_at: mp.played_at || "",
    created_at: "",
  };
}

const MP_SELECT = [
  "id",
  "match_id",
  "steam_id::text",
  "placement",
  "mmr_level",
  "hero_level",
  "chess_lineup",
  "synergies",
  "talents",
  "relic",
  "relic_history",
  "win_round",
  "lose_round",
  "played_at",
].join(", ");

/** Single cached fetch shared between generateMetadata and the page render.
 *  Port of the deleted matches getServerSideProps. */
const loadMatch = cache(
  async (rawId: string): Promise<Omit<GamePageProps, "route"> | null> => {
    if (!/^\d+$/.test(rawId)) return null;

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

    const { data: focusRow } = await supabase
      .from("match_players")
      .select(MP_SELECT)
      .eq("id", rawId)
      .single();

    if (!focusRow) return null;
    const mp = focusRow as unknown as MatchPlayerRow;

    // Fetch all players in this match + the match metadata in parallel.
    const [
      { data: allPlayers },
      { data: matchRow },
      steamProfile,
      timelineResult,
    ] = await Promise.all([
      supabase
        .from("match_players")
        .select(MP_SELECT)
        .eq("match_id", mp.match_id)
        .order("placement", { ascending: true }),
      supabase
        .from("matches")
        .select("played_at, capture_status, is_finished, verification_source")
        .eq("match_id", mp.match_id)
        .maybeSingle(),
      fetchSteamProfile(String(mp.steam_id), supabase),
      supabase
        .from("match_timelines")
        .select("timeline")
        .eq("match_id", mp.match_id)
        .maybeSingle(),
    ]);

    const players = (allPlayers as unknown as MatchPlayerRow[] | null) || [];
    const matchMeta = matchRow as MatchMetaRow | null;
    const playedAt = matchMeta?.played_at || "";

    // Stamp played_at from the matches table onto each player row.
    for (const p of players) {
      if (!p.played_at) p.played_at = playedAt;
    }
    if (!mp.played_at) mp.played_at = playedAt;

    const matchGames = players.map(mpToGame);
    const game = mpToGame(mp);

    const relicsMap = (relicsData as any).relics as Record<string, RelicInfo>;
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
        matchProfiles[sid] = await fetchSteamProfile(sid, supabase);
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <GameView route="/matches/[id]" {...data} />
    </>
  );
}
