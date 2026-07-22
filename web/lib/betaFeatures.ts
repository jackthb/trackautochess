"use client";

import { useEffect, useState } from "react";
import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import { getPostHog } from "@/lib/posthog";
import { useSessionFlags, type FlagAccess } from "@/lib/sessionFlags";

export type BetaFeatureAccess = FlagAccess;

/** @deprecated Prefer useSessionFlags — kept for any direct PostHog flag reads. */
export function usePostHogFlagAccess(
  flagKey: string,
  steamId: string | null | undefined,
): BetaFeatureAccess {
  const [access, setAccess] = useState<BetaFeatureAccess>(
    steamId ? "loading" : "disabled",
  );

  useEffect(() => {
    if (!steamId) {
      setAccess("disabled");
      return;
    }

    let cancelled = false;
    setAccess("loading");

    const failSafe = window.setTimeout(() => {
      if (!cancelled) {
        setAccess((prev) => (prev === "loading" ? "disabled" : prev));
      }
    }, 6_000);

    void getPostHog().then((posthog) => {
      if (cancelled) return;
      if (!posthog) {
        setAccess("disabled");
        return;
      }

      posthog.identify(steamId, { steam_id: steamId });

      const update = () => {
        if (!cancelled) {
          setAccess(
            posthog.isFeatureEnabled(flagKey) === true ? "enabled" : "disabled",
          );
        }
      };

      update();
      posthog.onFeatureFlags(update);
      posthog.reloadFeatureFlags();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(failSafe);
    };
  }, [flagKey, steamId]);

  return access;
}

export function useChatbotAccess(_steamId?: string | null): BetaFeatureAccess {
  const { admin } = useSessionFlags();
  return admin;
}

export { ADMIN_ACCESS_FLAG };
