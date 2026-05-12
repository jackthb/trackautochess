import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdminSteamId } from "@/lib/admin";
import { getSessionUser } from "@/lib/sessionUser";

interface GameRow {
  id: number;
  user_id: string | null;
  match_id: string | null;
  placement: string | null;
  rank: string | null;
  lineup: string | null;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase: SupabaseClient | null =
    supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey) : null;

  if (!supabase) {
    return res.status(500).json({ error: "Database not configured" });
  }

  const session = await getSessionUser(req, supabase);
  if (!isAdminSteamId(session.steamId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { data: gamesData, error: gamesError } = await supabase
    .from("games")
    .select("id, user_id::text, match_id, placement, rank, lineup, relic, played_at, created_at")
    .order("played_at", { ascending: false })
    .limit(GAMES_FETCH);

  if (gamesError) {
    return res.status(500).json({ error: gamesError.message });
  }

  const games = ((gamesData ?? []) as unknown as GameRow[]).map((g) => ({
    ...g,
    user_id: g.user_id == null ? null : String(g.user_id),
  }));

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
        const pa = parseInt(a.placement || "99") || 99;
        const pb = parseInt(b.placement || "99") || 99;
        return pa - pb;
      });
      const playedAt = sorted.reduce(
        (latest, g) => (g.played_at > latest ? g.played_at : latest),
        sorted[0].played_at
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
        steamId: r.user_id,
        name: null,
        customUrl: null,
        avatarUrl: null,
        placement: r.placement,
        rank: r.rank,
        lineup: r.lineup,
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

  return res.status(200).json({ matches });
}
