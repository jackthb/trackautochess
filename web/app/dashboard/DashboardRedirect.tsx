"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { playerProfilePath } from "@/lib/steam";
import { useSupabaseSession } from "@/lib/useSupabaseSession";

/**
 * Client island for /dashboard: resolves the signed-in user and redirects to
 * their player profile (or home).
 */
export function DashboardRedirect() {
  const router = useRouter();
  const { ready, supabase, user, steamId, customUrl } = useSupabaseSession();

  useEffect(() => {
    if (!ready) return;

    if (!supabase) {
      trackEvent("Dashboard Redirect Failed", { reason: "supabase_unavailable" });
      router.replace("/");
      return;
    }
    if (!user) {
      trackEvent("Dashboard Redirect Failed", { reason: "signed_out" });
      router.replace("/");
      return;
    }
    if (steamId) {
      trackEvent("Dashboard Redirect Completed", { destination: "player_profile" });
      router.replace(playerProfilePath(steamId, customUrl));
    } else {
      trackEvent("Dashboard Redirect Failed", { reason: "missing_steam_id" });
      router.replace("/");
    }
  }, [ready, supabase, user, steamId, customUrl, router]);

  return null;
}
