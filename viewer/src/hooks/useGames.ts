import { useState, useCallback, useEffect } from "react";
import type {
  Game,
  UnitsData,
  UnitFullInfo,
  SynergyInfo,
  RelicInfo,
} from "../types";

interface GamesState {
  games: Game[];
  loading: boolean;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  lastRefresh: Date | null;
  refresh: () => Promise<void>;
}

export function useGames(): GamesState {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({});
  const [unitsFull, setUnitsFull] = useState<Record<string, UnitFullInfo>>({});
  const [synergiesData, setSynergiesData] = useState<
    Record<string, SynergyInfo>
  >({});
  const [relicsData, setRelicsData] = useState<Record<string, RelicInfo>>({});
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);

    // Load reference data if needed
    if (Object.keys(unitCosts).length === 0) {
      try {
        const [unitsRes, fullRes, synRes, relRes] = await Promise.all([
          window.appApi.fetchUnitsData(),
          window.appApi.fetchUnitsFull(),
          window.appApi.fetchSynergies(),
          window.appApi.fetchRelics(),
        ]);
        if (unitsRes?.units) {
          const costs: Record<string, number> = {};
          for (const [name, info] of Object.entries(unitsRes.units)) {
            costs[name] = info.cost || 1;
          }
          setUnitCosts(costs);
        }
        if (fullRes) setUnitsFull(fullRes);
        if (synRes) setSynergiesData(synRes);
        if (relRes?.relics) setRelicsData(relRes.relics);
      } catch (e) {
        console.error("Failed to load reference data:", e);
      }
    }

    const data = await window.appApi.fetchGames();
    setGames(data || []);
    setLastRefresh(new Date());
    setLoading(false);
  }, [unitCosts]);

  useEffect(() => {
    refresh();
  }, []);

  return {
    games,
    loading,
    unitCosts,
    unitsFull,
    synergiesData,
    relicsData,
    lastRefresh,
    refresh,
  };
}
