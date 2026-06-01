"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppNavBar } from "@/components/app/AppNavBar";
import { Footer } from "@/components/Footer";
import { redactAnalyticsEvent } from "@/lib/analytics";
import { getPostHog } from "@/lib/posthog";

// Mirror _app.tsx: the cookie banner pulls in third-party scripts and is
// client-only, so defer it past first paint with ssr disabled.
const CookieConsentBanner = dynamic(
  () =>
    import("@/components/CookieConsentBanner").then((m) => ({
      default: m.CookieConsentBanner,
    })),
  { ssr: false }
);

/**
 * Client-side chrome for App Router routes — the App Router counterpart to the
 * wrapper logic in pages/_app.tsx. Bootstraps the Supabase client (for nav auth
 * state) and PostHog, and renders the shared nav/footer/analytics around the
 * page. Deliberately leaner than _app: no ads or BotId, which aren't needed on
 * the static pages migrated so far.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

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

  return (
    <>
      <AppNavBar supabase={supabase} />
      {children}
      <Footer />
      <Analytics beforeSend={redactAnalyticsEvent} />
      <SpeedInsights />
      <CookieConsentBanner />
    </>
  );
}
