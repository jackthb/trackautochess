/** A match — shared across all players. */
export interface Game {
  id: number;
  played_at: string;
  created_at: string;
}

/** One player's result in a match. */
export interface PlayerGame {
  id: number;
  game_id: number;
  user_id: number;
  placement: number;
  rank: string | null;
  rank_change: "up" | "down" | "none" | null;
  lineup: string | null;
  synergies: string | null;
  talents: string | null;
  relic: string | null;
  level: number | null;
  wins: number | null;
  losses: number | null;
  screenshot: string | null;
  replay: string | null;
  notes: string | null;
  created_at: string;
  /** Embedded game data from PostgREST join */
  game?: Game;
}
