"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { playerProfilePath } from "@/lib/steam";

/**
 * Client island for /dashboard: resolves the signed-in user and redirects to
 * their player profile (or home). Creates its own Supabase client since there's
 * no _app-provided prop in the App Router.
 */
export function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseClient();
    if (!supabase) {
      trackEvent("Dashboard Redirect Failed", { reason: "supabase_unavailable" });
      router.replace("/");
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      if (!user) {
        trackEvent("Dashboard Redirect Failed", { reason: "signed_out" });
        router.replace("/");
        return;
      }
      const steamId = user.user_metadata?.steam_id;
      const customUrl = user.user_metadata?.custom_url;
      if (steamId) {
        trackEvent("Dashboard Redirect Completed", { destination: "player_profile" });
        router.replace(playerProfilePath(steamId, customUrl));
      } else {
        trackEvent("Dashboard Redirect Failed", { reason: "missing_steam_id" });
        router.replace("/");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) router.replace("/");
    });
    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
