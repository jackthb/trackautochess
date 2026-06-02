import { useState, useCallback, useEffect, useRef } from "react";
import type {
  Game,
  UnitsData,
  UnitFullInfo,
  SynergyInfo,
  RelicInfo,
  ItemInfo,
  TalentInfo,
} from "../types";

interface GamesState {
  games: Game[];
  loading: boolean;
  refreshing: boolean;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  itemsData: Record<string, ItemInfo>;
  talentsData: Record<string, TalentInfo>;
  lastRefresh: Date | null;
  refresh: () => Promise<void>;
  updateGame: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
}

export function useGames(): GamesState {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialLoadDone = useRef(false);
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({});
  const [unitsFull, setUnitsFull] = useState<Record<string, UnitFullInfo>>({});
  const [synergiesData, setSynergiesData] = useState<
    Record<string, SynergyInfo>
  >({});
  const [relicsData, setRelicsData] = useState<Record<string, RelicInfo>>({});
  const [itemsData, setItemsData] = useState<Record<string, ItemInfo>>({});
  const [talentsData, setTalentsData] = useState<Record<string, TalentInfo>>({});
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!initialLoadDone.current) {
      setLoading(true);
    }
    setRefreshing(true);

    // Load reference data if needed
    if (Object.keys(unitCosts).length === 0) {
      try {
        const [unitsRes, fullRes, synRes, relRes, itemsRes, talentsRes] = await Promise.all([
          window.appApi.fetchUnitsData(),
          window.appApi.fetchUnitsFull(),
          window.appApi.fetchSynergies(),
          window.appApi.fetchRelics(),
          window.appApi.fetchItems(),
          window.appApi.fetchTalents(),
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
        if (itemsRes?.items) setItemsData(itemsRes.items);
        if (talentsRes) setTalentsData(talentsRes);
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
    initialLoadDone.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [unitCosts]);

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
    refreshing,
    unitCosts,
    unitsFull,
    synergiesData,
    relicsData,
    itemsData,
    talentsData,
    lastRefresh,
    refresh,
    updateGame,
  };
}
