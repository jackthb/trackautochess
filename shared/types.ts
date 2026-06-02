/**
 * A player's result in a match.
 *
 * Historically backed by the `games` table; now sourced from `match_players`.
 * Legacy field shapes (string placement, string level, etc.) are preserved
 * so rendering code doesn't need a big-bang rewrite — the query layer maps
 * match_players columns to these shapes.
 */
export interface Game {
  id: number;
  user_id: string;
  placement: string;
  rank: string | null;
  rank_change: string | null;
  lineup: string | null;
  synergies: string | null;
  talents: string | null;
  relic: string | null;
  level: string | null;
  wl: string | null;
  wins: number | null;
  losses: number | null;
  screenshot: string | null;
  replay: string | null;
  notes: string | null;
  match_id: string | null;
  played_at: string;
  created_at: string;

  /** match_players native fields — present when sourced from match_players */
  mmr_level?: number | null;
  hero_level?: number | null;
  chess_lineup?: string | null;
  relic_history?: unknown;
  win_round?: number | null;
  lose_round?: number | null;
}

/** @deprecated Use Game instead. */
export type PlayerGame = Game;

export interface UnitFullInfo {
  synergies?: string[];
  stats?: Record<string, {
    hp: number;
    atk: number | number[];
    armor: number;
    magic_resist: number;
    mana: number;
    atk_rate: number;
  }>;
  [key: string]: unknown;
}

export interface SynergyInfo {
  name: string;
  description?: string;
  formatted?: string;
  tiers?: number[];
  lore?: string;
  [key: string]: unknown;
}

export interface RelicInfo {
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface ItemFullInfo {
  name?: string;
  texture?: string;
  icon_url?: string | null;
  description?: string;
  [key: string]: unknown;
}

export interface ChessBoardPiece {
  slot_key?: string;
  chess?: string;
  name?: string;
  stars?: number;
  x?: number | null;
  y?: number | null;
  items?: string[];
  last_items?: string[];
  index?: number;
  buy_price?: number;
  water_id?: number;
}
