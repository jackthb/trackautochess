import type { StatItem } from "./StatsGrid";
import { mmrToRank } from "./game-utils";

interface GameForStats {
  placement: string | number;
}

interface DrodoForStats {
  mmr?: number | null;
  max_mmr?: number | null;
  queen_rank?: number | null;
  season_games?: number | null;
  candy?: number | null;
  chicken_count?: number | null;
  total_chicken_count?: number | null;
}

export interface StatGroups {
  tracked: StatItem[];
  drodo: StatItem[];
}

export function buildStatItems(
  games: GameForStats[],
  drodo: DrodoForStats | null | undefined
): StatGroups {
  const tracked: StatItem[] = [];

  if (games.length > 0) {
    const placements = games.map((g) => parseInt(String(g.placement)) || 0);
    const avg = (placements.reduce((a, b) => a + b, 0) / placements.length).toFixed(1);
    const top4 = placements.filter((p) => p >= 1 && p <= 4).length;
    const top4pct = ((top4 / games.length) * 100).toFixed(0);
    const wins = placements.filter((p) => p === 1).length;
    tracked.push(
      { key: "games", value: games.length, label: "Games", source: "tracked" },
      { key: "avg", value: avg, label: "Avg Place", tone: "gold", source: "tracked" },
      { key: "top4", value: `${top4pct}%`, label: "Top 4 Rate", tone: "green", source: "tracked" },
      { key: "wins", value: wins, label: "Wins", tone: "gold", source: "tracked" },
    );
  }

  const drodoItems: StatItem[] = [];
  if (drodo?.mmr != null) drodoItems.push({ key: "drodo-mmr", value: drodo.mmr, label: mmrToRank(drodo.mmr) || "MMR", source: "drodo" });
  if (drodo?.queen_rank != null) drodoItems.push({ key: "drodo-queen-rank", value: `#${drodo.queen_rank}`, label: "Queen Rank", tone: "gold", source: "drodo" });
  if (drodo?.max_mmr != null) drodoItems.push({ key: "drodo-peak", value: drodo.max_mmr, label: "Peak MMR", tone: "gold", source: "drodo" });
  if (drodo?.season_games != null) drodoItems.push({ key: "drodo-season-games", value: drodo.season_games, label: "Season Games", source: "drodo" });
  if (drodo?.candy != null) drodoItems.push({ key: "drodo-candy", value: drodo.candy, label: "Candies", tone: "gold", source: "drodo" });
  if (drodo?.chicken_count != null) drodoItems.push({ key: "drodo-chickens", value: drodo.chicken_count, label: "Season Wins", tone: "gold", source: "drodo" });
  if (drodo?.total_chicken_count != null && drodo.total_chicken_count !== drodo.chicken_count) drodoItems.push({ key: "drodo-total-chickens", value: drodo.total_chicken_count, label: "Total Wins", tone: "gold", source: "drodo" });

  return { tracked, drodo: drodoItems };
}
