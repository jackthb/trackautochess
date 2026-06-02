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

const BOT_ID_PROTECTED_ROUTES = [
  { path: "/api/drodo/*", method: "GET" },
  { path: "/api/drodo/*", method: "POST" },
  { path: "/api/players/search", method: "GET" },
  { path: "/api/support", method: "POST" },
];

const CookieConsentBanner = dynamic(
  () =>
    import("@/components/CookieConsentBanner").then((m) => ({
      default: m.CookieConsentBanner,
    })),
  { ssr: false },
);

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
      {process.env.NODE_ENV === "production" && (
        <BotIdClient protect={BOT_ID_PROTECTED_ROUTES} />
      )}
      <AppNavBar supabase={supabase} />
      {children}
      <Footer />
      <Analytics beforeSend={redactAnalyticsEvent} />
      <SpeedInsights />
      <CookieConsentBanner />
    </>
  );
}
