import { useMemo } from "react";
import { StatsGrid, type StatItem } from "@dac/shared/StatsGrid";
import type { Game, DrodoProfile } from "../types";
import { mmrToRank } from "../lib/game-utils";

interface StatsBarProps {
  games: Game[];
  drodo?: DrodoProfile | null;
}

export function StatsBar({ games, drodo }: StatsBarProps) {
  const items = useMemo<StatItem[]>(() => {
    const items: StatItem[] = [];
    if (!games.length) return items;
    const placements = games.map((g) => parseInt(g.placement) || 0);
    const avg = (
      placements.reduce((a, b) => a + b, 0) / placements.length
    ).toFixed(1);
    const top4 = placements.filter((p) => p >= 1 && p <= 4).length;
    const top4pct = ((top4 / games.length) * 100).toFixed(0);
    const wins = placements.filter((p) => p === 1).length;
    items.push(
      { key: "games", value: games.length, label: "Games", source: "tracked" },
      { key: "avg", value: avg, label: "Avg Place", tone: "gold", source: "tracked" },
      { key: "top4", value: `${top4pct}%`, label: "Top 4 Rate", tone: "green", source: "tracked" },
      { key: "wins", value: wins, label: "Wins", tone: "gold", source: "tracked" },
    );
    if (drodo?.mmr != null) items.push({ key: "drodo-mmr", value: drodo.mmr, label: mmrToRank(drodo.mmr) || "MMR", source: "drodo" });
    if (drodo?.max_mmr != null) items.push({ key: "drodo-peak", value: drodo.max_mmr, label: "Peak MMR", tone: "gold", source: "drodo" });
    if (drodo?.season_games != null) items.push({ key: "drodo-season-games", value: drodo.season_games, label: "Season Games", source: "drodo" });
    if (drodo?.chicken_count != null) items.push({ key: "drodo-chickens", value: drodo.chicken_count, label: "Chickens (Wins)", tone: "gold", source: "drodo" });
    return items;
  }, [games, drodo]);

  return <StatsGrid items={items} />;
}
