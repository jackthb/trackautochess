import { useState, useCallback, useEffect, useRef } from "react";
import type { DrodoProfile } from "../types";
import type { DrodoProfileEvent } from "../backend-events";
import { sendBackendRequest } from "../lib/backend-request";

interface DrodoState {
  drodo: DrodoProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDrodo(): DrodoState {
  const [drodo, setDrodo] = useState<DrodoProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchInFlight = useRef<Promise<void> | null>(null);

  const fetch = useCallback(async () => {
    if (fetchInFlight.current) return fetchInFlight.current;
    const run = (async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await sendBackendRequest<DrodoProfileEvent>({ cmd: "fetch_drodo" });
      if (response.error) {
        setError(response.error);
      } else if (response.profile) {
        setDrodo(response.profile as unknown as DrodoProfile);
      }
    } catch (e) {
      console.error("Failed to fetch drodo profile:", e);
      setError(e instanceof Error ? e.message : "Failed to fetch Auto Chess profile.");
    } finally {
      setLoading(false);
      fetchInFlight.current = null;
    }
    })();
    fetchInFlight.current = run;
    return run;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await sendBackendRequest<DrodoProfileEvent>({ cmd: "refresh_drodo" }, { timeoutMs: 30_000 });
      if (response.error) {
        setError(response.error);
      } else if (response.profile) {
        setDrodo(response.profile as unknown as DrodoProfile);
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
