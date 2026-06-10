import type { NextApiRequest } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RANK_BRACKETS } from "@dac/shared/game-utils";
import { isBetaFeaturesEnabledForSteamId } from "@/lib/betaFeaturesServer";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";

// Adapt a Web Request into the minimal NextApiRequest shape consumed by
// getSessionUser (it reads req.headers.authorization).
function toApiReq(req: Request): NextApiRequest {
  return {
    headers: { authorization: req.headers.get("authorization") ?? undefined },
  } as unknown as NextApiRequest;
}

function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank;
}

interface GameRow {
  id: number;
  steam_id: string | null;
  match_id: string | null;
  placement: number | null;
  mmr_level: number | null;
  hero_level: number | null;
  chess_lineup: string | null;
  synergies: string | null;
  relic: string | null;
  relic_history: unknown;
  win_round: number | null;
  lose_round: number | null;
  played_at: string;
  created_at: string;
  matches?: {
    capture_status: string | null;
    is_finished: boolean | null;
  } | null;
}

interface UserRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
}

export interface MatchPlayer {
  gameId: number;
  steamId: string | null;
  name: string | null;
  customUrl: string | null;
  avatarUrl: string | null;
  placement: string | null;
  rank: string | null;
  lineup: string | null;
  synergies: string | null;
  relic: string | null;
  relicHistory: unknown;
  level: string | null;
  wins: number | null;
  losses: number | null;
}

export interface MatchSummary {
  matchId: string | null;
  representativeGameId: number;
  playedAt: string;
  players: MatchPlayer[];
}

const PAGE_LIMIT = 100;
const GAMES_FETCH = 800;

export async function GET(req: Request) {
  const supabase: SupabaseClient | null = createSupabaseAnonClient();

  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const session = await getSessionUser(toApiReq(req), supabase);
  if (!(await isBetaFeaturesEnabledForSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: gamesData, error: gamesError } = await supabase
    .from("match_players")
    .select(
      "id, steam_id::text, match_id, placement, mmr_level, hero_level, chess_lineup, synergies, relic, relic_history, win_round, lose_round, played_at, created_at, matches!inner(capture_status, is_finished)"
    )
    .eq("matches.is_finished", true)
    .order("id", { ascending: false })
    .limit(GAMES_FETCH);

  if (gamesError) {
    return Response.json({ error: gamesError.message }, { status: 500 });
  }

  const games = (gamesData ?? []) as unknown as GameRow[];

  const grouped = new Map<string, GameRow[]>();
  for (const g of games) {
    const key = g.match_id || `solo:${g.id}`;
    const arr = grouped.get(key);
    if (arr) arr.push(g);
    else grouped.set(key, [g]);
  }

  const matches: MatchSummary[] = Array.from(grouped.entries())
    .map(([key, rows]) => {
      const sorted = [...rows].sort((a, b) => {
        const pa = a.placement ?? 99;
        const pb = b.placement ?? 99;
        return pa - pb;
      });
      const playedAt = sorted.reduce(
        (latest, g) => ((g.played_at || "") > latest ? (g.played_at || "") : latest),
        sorted[0].played_at || sorted[0].created_at || ""
      );
      return {
        matchId: key.startsWith("solo:") ? null : key,
        representativeGameId: sorted[0].id,
        playedAt,
        rows: sorted,
      };
    })
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt))
    .slice(0, PAGE_LIMIT)
    .map((m) => ({
      matchId: m.matchId,
      representativeGameId: m.representativeGameId,
      playedAt: m.playedAt,
      players: m.rows.map((r) => ({
        gameId: r.id,
        steamId: r.steam_id,
        name: null,
        customUrl: null,
        avatarUrl: null,
        placement: r.placement != null ? String(r.placement) : null,
        rank: r.mmr_level ? mmrLevelToRank(r.mmr_level) : null,
        lineup: r.chess_lineup,
        synergies: r.synergies,
        relic: r.relic,
        relicHistory: r.relic_history,
        level: r.hero_level != null ? String(r.hero_level) : null,
        wins: r.win_round,
        losses: r.lose_round,
      })),
    }));

  const steamIds = [
    ...new Set(
      matches
        .flatMap((m) => m.players.map((p) => p.steamId))
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (steamIds.length > 0) {
    const { data: userData } = await supabase
      .from("users")
      .select("steam_id::text, name, custom_url, avatar_url")
      .in("steam_id", steamIds);

    const userMap = new Map<string, UserRow>();
    for (const u of (userData ?? []) as unknown as UserRow[]) {
      userMap.set(String(u.steam_id), { ...u, steam_id: String(u.steam_id) });
    }
    for (const m of matches) {
      for (const p of m.players) {
        if (!p.steamId) continue;
        const u = userMap.get(p.steamId);
        if (u) {
          p.name = u.name;
          p.customUrl = u.custom_url;
          p.avatarUrl = u.avatar_url;
        }
      }
    }
  }

  return Response.json({ matches });
}
