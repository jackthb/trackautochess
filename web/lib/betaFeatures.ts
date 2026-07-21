"use client";

import { useEffect, useState } from "react";
import { ADMIN_ACCESS_FLAG } from "@/lib/adminFlags";
import { WEBSITE_BETA_FEATURES_FLAG } from "@/lib/betaFlags";
import { getPostHog } from "@/lib/posthog";

export type BetaFeatureAccess = "loading" | "enabled" | "disabled";

export function usePostHogFlagAccess(
  flagKey: string,
  steamId: string | null | undefined,
): BetaFeatureAccess {
  const [access, setAccess] = useState<BetaFeatureAccess>("disabled");

  useEffect(() => {
    setAccess("disabled");
    if (!steamId) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    setAccess("loading");
    void getPostHog().then((posthog) => {
      if (cancelled || !posthog) return;

      posthog.identify(steamId, { steam_id: steamId });

      const update = () => {
        if (!cancelled) {
          setAccess(
            posthog.isFeatureEnabled(flagKey) === true ? "enabled" : "disabled",
          );
        }
      };

      update();
      unsubscribe = posthog.onFeatureFlags(update);
      posthog.reloadFeatureFlags();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [flagKey, steamId]);

  return access;
}

export function useBetaFeaturesAccess(
  steamId: string | null | undefined,
): BetaFeatureAccess {
  return usePostHogFlagAccess(WEBSITE_BETA_FEATURES_FLAG, steamId);
}

export function useChatbotAccess(
  steamId: string | null | undefined,
): BetaFeatureAccess {
  return usePostHogFlagAccess(ADMIN_ACCESS_FLAG, steamId);
}

export function useBetaFeaturesEnabled(
  steamId: string | null | undefined,
): boolean {
  return useBetaFeaturesAccess(steamId) === "enabled";
}
