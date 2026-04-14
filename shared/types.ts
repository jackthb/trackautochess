/** A row from the `games` table — one player's result in a match. */
export interface Game {
  id: number;
  user_id: string;
  placement: string;
  rank: string | null;
  rank_change: "up" | "down" | "none" | null;
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
  played_at: string;
  created_at: string;
}

/** @deprecated Use Game instead — the table is flat, not split. */
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
