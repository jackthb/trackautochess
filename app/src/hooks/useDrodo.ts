import { useState, useCallback, useEffect } from "react";
import type { DrodoProfile, IpcErrorResult } from "../types";

interface DrodoState {
  drodo: DrodoProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function isErrorResult(
  value: DrodoProfile | IpcErrorResult | null
): value is IpcErrorResult {
  return Boolean(value && "error" in value);
}

export function useDrodo(): DrodoState {
  const [drodo, setDrodo] = useState<DrodoProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.appApi.fetchDrodo();
      if (isErrorResult(data)) {
        setError(data.error);
      } else if (data) {
        setDrodo(data);
      }
    } catch (e) {
      console.error("Failed to fetch drodo profile:", e);
      setError(e instanceof Error ? e.message : "Failed to fetch Auto Chess profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.appApi.refreshDrodo();
      if (isErrorResult(data)) {
        setError(data.error);
      } else if (data) {
        setDrodo(data);
      }
    } catch (e) {
      console.error("Failed to refresh drodo profile:", e);
      setError(e instanceof Error ? e.message : "Failed to refresh Auto Chess profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { drodo, loading, error, refresh };
}
