import { createSupabaseAnonClient } from "@/lib/supabase";

/**
 * The home page links to a real tracked game so visitors can see what the
 * pre-release tracker captures before signing up. Rather than hard-coding a
 * match id that can be deleted, pick the newest finished match with a complete
 * capture and link to its winner's row (`/matches/<match_players.id>`).
 */

export interface FeaturedMatch {
  /** `match_players.id` — the id `/matches/[id]` takes. */
  matchPlayerId: number;
  playedAt: string | null;
  /** Roster size, so the copy can say "all 8 players" honestly. */
  playerCount: number;
}

interface FeaturedRow {
  id: number;
  match_id: string | null;
  placement: number | null;
  played_at: string | null;
  matches: { capture_status: string | null } | null;
}

/** How many recent rows to scan for a match with a full roster. */
const SCAN_LIMIT = 200;
const FULL_ROSTER = 8;

export async function fetchFeaturedMatch(): Promise<FeaturedMatch | null> {
  const supabase = createSupabaseAnonClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("match_players")
      .select(
        "id, match_id, placement, played_at, matches!inner(capture_status, is_finished)"
      )
      .eq("matches.is_finished", true)
      .order("id", { ascending: false })
      .limit(SCAN_LIMIT);

    if (error) return null;

    const rows = (data ?? []) as unknown as FeaturedRow[];
    const byMatch = new Map<string, FeaturedRow[]>();
    for (const row of rows) {
      if (!row.match_id) continue;
      const group = byMatch.get(row.match_id);
      if (group) group.push(row);
      else byMatch.set(row.match_id, [row]);
    }

    // Map iteration preserves insertion order and rows arrive newest-first, so
    // the first qualifying group is the newest. A complete capture is the best
    // showcase, but fall back to any finished full-roster match rather than
    // dropping the example link entirely.
    let fallback: FeaturedMatch | null = null;
    for (const group of byMatch.values()) {
      if (group.length < FULL_ROSTER) continue;
      const winner =
        group.find((row) => row.placement === 1) ??
        [...group].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))[0];
      if (!winner) continue;

      const featured: FeaturedMatch = {
        matchPlayerId: winner.id,
        playedAt: winner.played_at,
        playerCount: group.length,
      };
      if (group.some((row) => row.matches?.capture_status === "complete")) {
        return featured;
      }
      fallback ??= featured;
    }

    return fallback;
  } catch {
    return null;
  }
}
