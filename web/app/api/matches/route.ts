import type { NextApiRequest } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RANK_BRACKETS } from "@dac/shared/game-utils";
import { isBetaFeaturesEnabledForSteamId } from "@/lib/betaFeaturesServer";
import { getSessionUser } from "@/lib/sessionUser";

// Adapt a Web Request into the minimal NextApiRequest shape consumed by
// getSessionUser (it reads req.headers.authorization).
function toApiReq(req: Request): NextApiRequest {
  return {
    headers: { authorization: req.headers.get("authorization") ?? undefined },
  } as unknown as NextApiRequest;
}

function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank.replace("-", " ");
}

interface GameRow {
  id: number;
  steam_id: string | null;
  match_id: string | null;
  placement: number | null;
  mmr_level: number | null;
  chess_lineup: string | null;
  relic: string | null;
  played_at: string;
  created_at: string;
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
  relic: string | null;
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase: SupabaseClient | null =
    supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey) : null;

  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const session = await getSessionUser(toApiReq(req), supabase);
  if (!(await isBetaFeaturesEnabledForSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: gamesData, error: gamesError } = await supabase
    .from("match_players")
    .select("id, steam_id::text, match_id, placement, mmr_level, chess_lineup, relic, played_at, created_at")
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
        relic: r.relic,
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
