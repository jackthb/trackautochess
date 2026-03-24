export interface Game {
  id: number;
  played_at: string;
  placement: string;
  rank: string | null;
  rank_change: string | null;
  lineup: string | null;
  synergies: string | null;
  relic: string | null;
  level: string | null;
  wl: string | null;
  screenshot: string | null;
  replay: string | null;
  user_id: string;
  created_at: string;
}
