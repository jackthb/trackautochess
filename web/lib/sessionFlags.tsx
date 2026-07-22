"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSupabaseSession } from "@/lib/useSupabaseSession";

export type FlagAccess = "loading" | "enabled" | "disabled";

interface SessionFlagsContextValue {
  ready: boolean;
  steamId: string | null;
  admin: FlagAccess;
}

const SIGNED_OUT: SessionFlagsContextValue = {
  ready: true,
  steamId: null,
  admin: "disabled",
};

const SessionFlagsContext = createContext<SessionFlagsContextValue>({
  ready: false,
  steamId: null,
  admin: "loading",
});

/**
 * Server-evaluated PostHog `admin_access` for the signed-in Steam session.
 * Fetches once per steamId.
 */
export function SessionFlagsProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, steamId, accessToken } = useSupabaseSession();
  const [resolved, setResolved] = useState<{
    steamId: string;
    admin: boolean;
  } | null>(null);
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!authReady) return;

    if (!accessToken || !steamId) {
      fetchedFor.current = null;
      setResolved(null);
      return;
    }

    if (fetchedFor.current === steamId) {
      return;
    }

    let cancelled = false;

    void fetch("/api/me/flags", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`flags ${resp.status}`);
        return (await resp.json()) as { admin_access?: boolean };
      })
      .then((data) => {
        if (cancelled) return;
        fetchedFor.current = steamId;
        setResolved({
          steamId,
          admin: data.admin_access === true,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, accessToken, steamId]);

  const value = useMemo<SessionFlagsContextValue>(() => {
    if (!authReady) {
      return { ready: false, steamId, admin: "loading" };
    }

    if (!steamId || !accessToken) {
      return SIGNED_OUT;
    }

    if (!resolved || resolved.steamId !== steamId) {
      return { ready: false, steamId, admin: "loading" };
    }

    return {
      ready: true,
      steamId,
      admin: resolved.admin ? "enabled" : "disabled",
    };
  }, [authReady, accessToken, steamId, resolved]);

  return (
    <SessionFlagsContext.Provider value={value}>
      {children}
    </SessionFlagsContext.Provider>
  );
}

export function useSessionFlags(): SessionFlagsContextValue {
  return useContext(SessionFlagsContext);
}
