"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BotIdClient } from "botid/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppNavBar } from "@/components/app/AppNavBar";
import { Footer } from "@/components/Footer";
import { redactAnalyticsEvent } from "@/lib/analytics";
import { getPostHog } from "@/lib/posthog";

// Client-side half of Vercel BotId: it injects the verification token into
// requests to these protected routes. The server (checkBotId in each route)
// flags requests WITHOUT the token as bots, so this must stay mounted — without
// it, real users get 403s (e.g. player search returns "no users"). Mirrors the
// list from the old pages/_app.tsx.
const BOT_ID_PROTECTED_ROUTES = [
  { path: "/api/drodo/*", method: "GET" },
  { path: "/api/drodo/*", method: "POST" },
  { path: "/api/players/search", method: "GET" },
  { path: "/api/support", method: "POST" },
];

// Mirror _app.tsx: the cookie banner pulls in third-party scripts and is
// client-only, so defer it past first paint with ssr disabled.
const CookieConsentBanner = dynamic(
  () =>
    import("@/components/CookieConsentBanner").then((m) => ({
      default: m.CookieConsentBanner,
    })),
  { ssr: false }
);

// Loaded only when embedded in the Sanity Presentation iframe (see below).
const AppVisualEditing = dynamic(
  () => import("@/components/app/AppVisualEditing"),
  { ssr: false }
);

/**
 * Client-side chrome for App Router routes — the App Router counterpart to the
 * wrapper logic in pages/_app.tsx. Bootstraps the Supabase client (for nav auth
 * state) and PostHog, and renders the shared nav/footer/analytics + BotId client
 * around the page. (Ads are still omitted vs _app.)
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/supabase").then(({ createSupabaseClient }) => {
      if (!cancelled) setSupabase(createSupabaseClient());
    });
    void getPostHog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The Sanity Presentation tool loads the site in an iframe. Mount visual
    // editing whenever we're embedded — on EVERY page, not just ones that opt
    // into draft mode — so the Studio always connects. Top-level visitors never
    // load the overlay or open a Sanity live connection.
    try {
      setEmbedded(window.self !== window.top);
    } catch {
      // Accessing window.top cross-origin can throw; that means we're embedded.
      setEmbedded(true);
    }
  }, []);

  return (
    <>
      {process.env.NODE_ENV === "production" && (
        <BotIdClient protect={BOT_ID_PROTECTED_ROUTES} />
      )}
      <AppNavBar supabase={supabase} />
      {children}
      <Footer />
      <Analytics beforeSend={redactAnalyticsEvent} />
      <SpeedInsights />
      <CookieConsentBanner />
      {embedded && <AppVisualEditing />}
    </>
  );
}
