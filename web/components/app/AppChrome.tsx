"use client";

import { useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BotIdClient } from "botid/client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AppNavBar } from "@/components/app/AppNavBar";
import { Footer } from "@/components/Footer";
import { trackEvent } from "@/lib/analytics";
import { getPostHog } from "@/lib/posthog";
import { useSupabaseSession } from "@/lib/useSupabaseSession";

const ChatWidget = dynamic(
  () =>
    import("@/components/ChatWidget").then((module) => ({
      default: module.ChatWidget,
    })),
  { ssr: false },
);

const BOT_ID_PROTECTED_ROUTES = [
  { path: "/api/drodo/*", method: "GET" },
  { path: "/api/drodo/*", method: "POST" },
  { path: "/api/players/search", method: "GET" },
  { path: "/api/chat", method: "POST" },
  { path: "/api/queens/refresh", method: "POST" },
  { path: "/api/support", method: "POST" },
];

const CookieConsentBanner = dynamic(
  () =>
    import("@/components/CookieConsentBanner").then((m) => ({
      default: m.CookieConsentBanner,
    })),
  { ssr: false },
);

function trackSteamAuthEvent(event: AuthChangeEvent, session: Session | null) {
  const user = session?.user;
  const steamId = user?.user_metadata?.steam_id;
  if (event !== "SIGNED_IN" || typeof steamId !== "string" || !steamId) return;
  const sessionTrackKey = session?.access_token
    ? `dac.auth.identified.${steamId}.${session.access_token.slice(-12)}`
    : null;
  const alreadyTracked = sessionTrackKey
    ? window.sessionStorage.getItem(sessionTrackKey) === "1"
    : false;

  void getPostHog().then((posthog) => {
    if (!posthog) return;

    const previousDistinctId = posthog.get_distinct_id();
    if (!alreadyTracked && previousDistinctId && previousDistinctId !== steamId) {
      posthog.alias(steamId, previousDistinctId);
    }

    posthog.identify(steamId, {
      steam_id: steamId,
      has_custom_url: typeof user.user_metadata?.custom_url === "string",
      has_avatar: typeof user.user_metadata?.avatar_url === "string",
    });

    if (alreadyTracked) return;

    posthog.capture("Steam Sign In Identified", {
      source: "supabase_auth_state",
      auth_event: event,
      had_previous_anonymous_id: Boolean(previousDistinctId && previousDistinctId !== steamId),
    });
    if (sessionTrackKey) window.sessionStorage.setItem(sessionTrackKey, "1");
  });
}

export function AppChrome({ children }: { children: ReactNode }) {
  const { supabase } = useSupabaseSession();

  useEffect(() => {
    void getPostHog();
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      trackSteamAuthEvent(event, session);
      if (event === "SIGNED_OUT") {
        trackEvent("Steam Sign Out Completed", { source: "supabase_auth_state" });
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  return (
    <>
      {process.env.NODE_ENV === "production" && (
        <BotIdClient protect={BOT_ID_PROTECTED_ROUTES} />
      )}
      <AppNavBar />
      {children}
      <Footer />
      <SpeedInsights />
      <CookieConsentBanner />
      <ChatWidget />
    </>
  );
}
