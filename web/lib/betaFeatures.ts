"use client";

import { useEffect, useState } from "react";
import { isAdminSteamId } from "@/lib/admin";
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
  const flagAccess = usePostHogFlagAccess(WEBSITE_BETA_FEATURES_FLAG, steamId);
  // Admins always see beta pages (Matches nav, /matches, etc.) even when the
  // PostHog flag is off or hasn't loaded for their distinct_id.
  if (isAdminSteamId(steamId)) return "enabled";
  return flagAccess;
}

export function useChatbotAccess(
  steamId: string | null | undefined,
): BetaFeatureAccess {
  if (!steamId) return "disabled";
  return isAdminSteamId(steamId) ? "enabled" : "disabled";
}

export function useBetaFeaturesEnabled(
  steamId: string | null | undefined,
): boolean {
  return useBetaFeaturesAccess(steamId) === "enabled";
}
