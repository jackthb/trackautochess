import { useState, useCallback, useEffect, useRef } from "react";
import type {
  UnitFullInfo,
  SynergyInfo,
  RelicInfo,
  ItemInfo,
  ItemFullInfo,
  TalentInfo,
} from "../types";
import { buildItemSynergyLookup } from "@dac/shared/game-structure";

interface ContentDataState {
  loading: boolean;
  error: string | null;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  itemsData: Record<string, ItemInfo>;
  itemsFull: Record<string, ItemFullInfo>;
  itemSynergies: Record<string, string>;
  talentsData: Record<string, TalentInfo>;
}

export function useContentData(): ContentDataState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadInFlight = useRef(false);
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({});
  const [unitsFull, setUnitsFull] = useState<Record<string, UnitFullInfo>>({});
  const [synergiesData, setSynergiesData] = useState<
    Record<string, SynergyInfo>
  >({});
  const [relicsData, setRelicsData] = useState<Record<string, RelicInfo>>({});
  const [itemsData, setItemsData] = useState<Record<string, ItemInfo>>({});
  const [itemsFull, setItemsFull] = useState<Record<string, ItemFullInfo>>({});
  const [itemSynergies, setItemSynergies] = useState<Record<string, string>>({});
  const [talentsData, setTalentsData] = useState<Record<string, TalentInfo>>({});

  const load = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const [unitsRes, fullRes, synRes, relRes, itemsRes, itemsFullRes, itemLinksRes, talentsRes] =
        await Promise.all([
          window.appApi.fetchUnitsData(),
          window.appApi.fetchUnitsFull(),
          window.appApi.fetchSynergies(),
          window.appApi.fetchRelics(),
          window.appApi.fetchItems(),
          window.appApi.fetchItemsFull(),
          window.appApi.fetchItemLinks(),
          window.appApi.fetchTalents(),
        ]);

      if (unitsRes?.units) {
        const costs: Record<string, number> = {};
        for (const [name, info] of Object.entries(unitsRes.units)) {
          costs[name] = info.cost || 1;
        }
        const aliases = unitsRes.aliases || {};
        for (const [alias, canonical] of Object.entries(aliases)) {
          if (costs[canonical] !== undefined) {
            costs[alias] = costs[canonical];
          }
        }
        setUnitCosts(costs);
      }

      if (fullRes) {
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
      if (itemsFullRes) setItemsFull(itemsFullRes);
      if (itemLinksRes) {
        setItemSynergies(buildItemSynergyLookup(itemLinksRes, itemsFullRes));
      }
      if (talentsRes) setTalentsData(talentsRes);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to load game reference data.";
      console.error("Failed to load reference data:", e);
      setError(message);
    } finally {
      setLoading(false);
      loadInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    error,
    unitCosts,
    unitsFull,
    synergiesData,
    relicsData,
    itemsData,
    itemsFull,
    itemSynergies,
    talentsData,
  };
}
