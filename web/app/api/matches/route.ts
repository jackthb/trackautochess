import { mmrLevelToRank } from "@dac/shared/game-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toApiReq } from "@/lib/abuseLog";
import { isBetaFeaturesEnabledForSteamId } from "@/lib/betaFeaturesServer";
import { duplicateMatchTimeBucket } from "@/lib/matches";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";

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
  final_round: number | null;
  duration: number | null;
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

function matchGroupKey(row: GameRow): string {
  if (row.match_id) return row.match_id;
  return `played:${row.played_at || row.created_at || row.id}`;
}

function duplicateMatchKey(rows: GameRow[], playedAt: string): string {
  const roster = rows
    .map((row) => `${row.steam_id ?? "unknown"}:${row.placement ?? "?"}`)
    .sort()
    .join("|");
  return [duplicateMatchTimeBucket(playedAt), roster].join("::");
}

function dedupeMatchRows(rows: GameRow[]): GameRow[] {
  const byPlayer = new Map<string, GameRow>();
  for (const row of rows) {
    const key = row.steam_id || `row:${row.id}`;
    const current = byPlayer.get(key);
    if (!current || row.id > current.id) {
      byPlayer.set(key, row);
    }
  }
  return [...byPlayer.values()];
}

function captureRank(rows: GameRow[]): number {
  const statuses = rows.map((row) => row.matches?.capture_status);
  if (statuses.includes("complete")) return 3;
  if (statuses.includes("partial")) return 2;
  return 1;
}

function pickBetterMatch<T extends { rows: GameRow[]; playedAt: string }>(
  current: T,
  candidate: T
): T {
  const currentRank = captureRank(current.rows);
  const candidateRank = captureRank(candidate.rows);
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank ? candidate : current;
  }
  if (candidate.rows.length !== current.rows.length) {
    return candidate.rows.length > current.rows.length ? candidate : current;
  }
  const currentLatestId = Math.max(...current.rows.map((row) => row.id));
  const candidateLatestId = Math.max(...candidate.rows.map((row) => row.id));
  return candidateLatestId > currentLatestId ? candidate : current;
}

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
      "id, steam_id::text, match_id, placement, mmr_level, hero_level, chess_lineup, synergies, relic, relic_history, win_round, lose_round, final_round, duration, played_at, created_at, matches!inner(capture_status, is_finished)"
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
    const key = matchGroupKey(g);
    const arr = grouped.get(key);
    if (arr) arr.push(g);
    else grouped.set(key, [g]);
  }

  const rawMatches = Array.from(grouped.entries())
    .map(([key, rows]) => {
      const sorted = dedupeMatchRows(rows).sort((a, b) => {
        const pa = a.placement ?? 99;
        const pb = b.placement ?? 99;
        return pa - pb;
      });
      const playedAt = sorted.reduce(
        (latest, g) => ((g.played_at || "") > latest ? (g.played_at || "") : latest),
        sorted[0].played_at || sorted[0].created_at || ""
      );
      return {
        matchId: key.startsWith("played:") ? null : key,
        representativeGameId: sorted[0].id,
        playedAt,
        rows: sorted,
      };
    })
    .filter((match) => match.rows.length > 0);

  const dedupedBySignature = new Map<string, (typeof rawMatches)[number]>();
  for (const match of rawMatches) {
    const key = duplicateMatchKey(match.rows, match.playedAt);
    const current = dedupedBySignature.get(key);
    dedupedBySignature.set(
      key,
      current ? pickBetterMatch(current, match) : match
    );
  }

  const matches: MatchSummary[] = Array.from(dedupedBySignature.values())
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
      .filter("steam_id", "in", `(${steamIds.join(",")})`);

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
