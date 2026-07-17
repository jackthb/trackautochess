import type { StatItem } from "./StatsGrid";
import { mmrLevelToRank, mmrToRank } from "./game-utils";

interface GameForStats {
  placement: string | number;
}

interface DrodoForStats {
  mmr?: number | null;
  max_mmr?: number | null;
  mmr_level?: number | null;
  queen_rank?: number | null;
  season_games?: number | null;
  candy?: number | null;
  chicken_count?: number | null;
  total_chicken_count?: number | null;
  /** When true, hide numeric MMR and show rank from mmr_level only. */
  rankOnly?: boolean;
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
    const winPct = ((wins / games.length) * 100).toFixed(0);
    tracked.push(
      { key: "win-rate", value: `${winPct}%`, label: "Win Rate", tone: "gold", source: "tracked" },
      { key: "wins", value: wins, label: "Wins", tone: "gold", source: "tracked" },
      { key: "games", value: games.length, label: "Games", source: "tracked" },
      { key: "avg", value: avg, label: "Avg Place", tone: "gold", source: "tracked" },
      { key: "top4", value: `${top4pct}%`, label: "Top 4 Rate", tone: "green", source: "tracked" },
    );
  }

  const drodoItems: StatItem[] = [];
  const rankOnly = Boolean(drodo?.rankOnly);
  if (rankOnly && drodo?.mmr_level != null && drodo.mmr_level > 0) {
    const rank = mmrLevelToRank(drodo.mmr_level) || "Rank";
    const rankLabel =
      rank === "Queen" && drodo.queen_rank != null
        ? `Rank · Queen #${drodo.queen_rank}`
        : rank === "Rank"
          ? "Rank"
          : `Rank · ${rank}`;
    drodoItems.push({
      key: "drodo-rank",
      value: rank,
      label: rankLabel,
      source: "drodo",
    });
  } else if (!rankOnly && drodo?.mmr != null) {
    const rank = mmrToRank(drodo.mmr) || "MMR";
    const rankLabel = rank === "Queen" && drodo.queen_rank != null
      ? `MMR · Queen #${drodo.queen_rank}`
      : rank === "MMR"
        ? "MMR"
        : `MMR · ${rank}`;
    drodoItems.push({ key: "drodo-mmr", value: drodo.mmr, label: rankLabel, source: "drodo" });
  }
  if (!rankOnly && drodo?.max_mmr != null && drodo.max_mmr !== drodo.mmr) {
    drodoItems.push({ key: "drodo-peak", value: drodo.max_mmr, label: "Peak MMR", tone: "gold", source: "drodo" });
  }
  if (drodo?.season_games != null && drodo.season_games > 0 && drodo?.chicken_count != null) {
    const winPct = ((drodo.chicken_count / drodo.season_games) * 100).toFixed(0);
    drodoItems.push({ key: "drodo-win-rate", value: `${winPct}%`, label: "Win Rate", tone: "gold", source: "drodo" });
  }
  if (drodo?.chicken_count != null) drodoItems.push({ key: "drodo-chickens", value: drodo.chicken_count, label: "Season Wins", tone: "gold", source: "drodo" });
  if (drodo?.season_games != null) drodoItems.push({ key: "drodo-season-games", value: drodo.season_games, label: "Season Games", source: "drodo" });
  if (drodo?.candy != null) drodoItems.push({ key: "drodo-candy", value: drodo.candy, label: "Candies", tone: "gold", source: "drodo" });
  if (drodo?.total_chicken_count != null && drodo.total_chicken_count !== drodo.chicken_count) drodoItems.push({ key: "drodo-total-chickens", value: drodo.total_chicken_count, label: "Total Wins", tone: "gold", source: "drodo" });

  return { tracked, drodo: drodoItems };
}
