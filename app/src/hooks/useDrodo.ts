import { useState, useCallback, useEffect } from "react";
import type { DrodoProfile } from "../types";

interface DrodoState {
  drodo: DrodoProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useDrodo(): DrodoState {
  const [drodo, setDrodo] = useState<DrodoProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.appApi.fetchDrodo();
      if (data) setDrodo(data);
    } catch (e) {
      console.error("Failed to fetch drodo profile:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.appApi.refreshDrodo();
      if (data) setDrodo(data);
    } catch (e) {
      console.error("Failed to refresh drodo profile:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { drodo, loading, refresh };
}
