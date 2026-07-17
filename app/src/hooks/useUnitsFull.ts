import { useState, useCallback, useEffect } from "react";
import type { UnitFullInfo } from "../types";

/** Units lookup for admin legendary overlay only. */
export function useUnitsFull(): {
  unitsFull: Record<string, UnitFullInfo>;
} {
  const [unitsFull, setUnitsFull] = useState<Record<string, UnitFullInfo>>({});

  const load = useCallback(async () => {
    try {
      const fullRes = await window.appApi.fetchUnitsFull();
      if (fullRes) setUnitsFull(fullRes);
    } catch {
      // Overlay falls back to raw chess codes if content fails to load.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { unitsFull };
}
