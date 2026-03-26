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
  updateGame: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
  deleteGame: (gameId: number) => Promise<boolean>;
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
          // Expand aliases so both names resolve
          const aliases = unitsRes.aliases || {};
          for (const [alias, canonical] of Object.entries(aliases)) {
            if (costs[canonical] !== undefined) {
              costs[alias] = costs[canonical];
            }
          }
          setUnitCosts(costs);
        }
        if (fullRes) {
          // Expand aliases into unitsFull too
          const aliases = unitsRes?.aliases || {};
          for (const [alias, canonical] of Object.entries(aliases)) {
            if (fullRes[canonical] && !fullRes[alias]) {
              fullRes[alias] = fullRes[canonical];
            }
          }
          setUnitsFull(fullRes);
        }
        if (synRes) setSynergiesData(synRes);
        if (relRes?.relics) setRelicsData(relRes.relics);
      } catch (e) {
        console.error("Failed to load reference data:", e);
      }
    }

    const data = await window.appApi.fetchGames();
    const sorted = (data || []).slice().sort(
      (a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime()
    );
    setGames(sorted);
    setLastRefresh(new Date());
    setLoading(false);
  }, [unitCosts]);

  const deleteGame = useCallback(async (gameId: number): Promise<boolean> => {
    const ok = await window.appApi.deleteGame(gameId);
    if (ok) {
      setGames((prev) => prev.filter((g) => g.id !== gameId));
    }
    return ok;
  }, []);

  const updateGame = useCallback(
    async (gameId: number, fields: Partial<Game>): Promise<boolean> => {
      const ok = await window.appApi.updateGame(gameId, fields);
      if (ok) {
        setGames((prev) => {
          const updated = prev.map((g) => (g.id === gameId ? { ...g, ...fields } : g));
          return updated.slice().sort(
            (a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime()
          );
        });
      }
      return ok;
    },
    []
  );

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
    updateGame,
    deleteGame,
  };
}
