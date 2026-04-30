import { useMemo } from "react";
import { StatsGrid } from "@dac/shared/StatsGrid";
import { buildStatItems } from "@dac/shared/buildStatItems";
import type { Game, DrodoProfile } from "../types";

interface StatsBarProps {
  games: Game[];
  drodo?: DrodoProfile | null;
}

export function StatsBar({ games, drodo }: StatsBarProps) {
  const { tracked, drodo: drodoItems } = useMemo(
    () => buildStatItems(games, drodo),
    [games, drodo]
  );

  if (!tracked.length && !drodoItems.length) return null;

  return (
    <>
      {tracked.length > 0 && (
        <>
          <div className="section-title">Tracked</div>
          <StatsGrid items={tracked} />
        </>
      )}
      {drodoItems.length > 0 && (
        <>
          <div className="section-title">Auto Chess</div>
          <StatsGrid items={drodoItems} />
        </>
      )}
    </>
  );
}
