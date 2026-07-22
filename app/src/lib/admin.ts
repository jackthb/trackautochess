/**
 * Admin access for desktop-only tooling (outbox flush, legendary overlay).
 * Uses the same PostHog `admin_access` flag as the web viewer — manage
 * membership in PostHog, not in this hardcoded list.
 */
import { useEffect, useState } from "react";
import { getPostHog } from "./posthog";

export const ADMIN_ACCESS_FLAG = "admin_access";

export type AdminAccess = "loading" | "enabled" | "disabled";

export function useAdminAccess(
  steamId: string | null | undefined,
): AdminAccess {
  const [access, setAccess] = useState<AdminAccess>("disabled");

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
            posthog.isFeatureEnabled(ADMIN_ACCESS_FLAG) === true
              ? "enabled"
              : "disabled",
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
  }, [steamId]);

  return access;
}

export function useIsAdmin(steamId: string | null | undefined): boolean {
  return useAdminAccess(steamId) === "enabled";
}
