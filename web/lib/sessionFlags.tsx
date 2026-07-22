"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { isHardcodedAdminSteamId } from "@/lib/adminFlags";

export type FlagAccess = "loading" | "enabled" | "disabled";

interface SessionFlags {
  admin_access: boolean;
  website_beta_features: boolean;
}

interface SessionFlagsContextValue {
  ready: boolean;
  steamId: string | null;
  admin: FlagAccess;
  beta: FlagAccess;
}

const SessionFlagsContext = createContext<SessionFlagsContextValue>({
  ready: false,
  steamId: null,
  admin: "loading",
  beta: "loading",
});

/**
 * Server-evaluated PostHog flags for the signed-in Steam session.
 * Avoids depending on posthog-js in the browser (ad blockers / cookieless).
 */
export function SessionFlagsProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, steamId, accessToken } = useSupabaseSession();
  const [flags, setFlags] = useState<SessionFlags | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authReady) return;

    if (!accessToken || !steamId) {
      setFlags(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFlags(null);

    void fetch("/api/me/flags", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`flags ${resp.status}`);
        return (await resp.json()) as SessionFlags;
      })
      .then((data) => {
        if (!cancelled) {
          setFlags({
            admin_access: data.admin_access === true,
            website_beta_features: data.website_beta_features === true,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Fail closed for strangers; hardcoded admins still get in if PostHog dies.
          const admin = isHardcodedAdminSteamId(steamId);
          setFlags({
            admin_access: admin,
            website_beta_features: admin,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, accessToken, steamId]);

  const value = useMemo<SessionFlagsContextValue>(() => {
    if (!authReady || (Boolean(accessToken && steamId) && loading && !flags)) {
      return { ready: false, steamId, admin: "loading", beta: "loading" };
    }
    if (!steamId || !accessToken) {
      return {
        ready: true,
        steamId: null,
        admin: "disabled",
        beta: "disabled",
      };
    }
    return {
      ready: true,
      steamId,
      admin:
        flags?.admin_access || isHardcodedAdminSteamId(steamId)
          ? "enabled"
          : "disabled",
      beta:
        flags?.website_beta_features || isHardcodedAdminSteamId(steamId)
          ? "enabled"
          : "disabled",
    };
  }, [authReady, accessToken, steamId, loading, flags]);

  return (
    <SessionFlagsContext.Provider value={value}>
      {children}
    </SessionFlagsContext.Provider>
  );
}

export function useSessionFlags(): SessionFlagsContextValue {
  return useContext(SessionFlagsContext);
}
