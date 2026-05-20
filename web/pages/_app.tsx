import "@/styles/globals.css";
import type { AppProps } from "next/app";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BotIdClient } from "botid/client";
import { Footer } from "@/components/Footer";
import { NavBar } from "@/components/NavBar";
import { shouldShowGlobalAd } from "@/lib/ads";
import { redactAnalyticsEvent } from "@/lib/analytics";
import { getPostHog, identify, reset } from "@/lib/posthog";
import type { SupabaseClient } from "@supabase/supabase-js";

// Defer the ad iframe and the cookie banner until after first paint — they
// pull in third-party scripts (ad provider, PostHog) and don't need to be
// on the critical path.
const BannerAd = dynamic(
  () => import("@/components/BannerAd").then((m) => ({ default: m.BannerAd })),
  { ssr: false }
);
const CookieConsentBanner = dynamic(
  () =>
    import("@/components/CookieConsentBanner").then((m) => ({
      default: m.CookieConsentBanner,
    })),
  { ssr: false }
);

const SanityVisualEditing = dynamic(
  () => import("@/components/SanityVisualEditing"),
  { ssr: false }
);

const BOT_ID_PROTECTED_ROUTES = [
  { path: "/api/drodo/*", method: "GET" },
  { path: "/api/drodo/*", method: "POST" },
  { path: "/api/players/search", method: "GET" },
  { path: "/api/support", method: "POST" },
];

interface AppPageProps {
  draftMode?: boolean;
  [key: string]: unknown;
}

export default function App({ Component, pageProps }: AppProps<AppPageProps>) {
  const router = useRouter();
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSessionAndAnalytics = () => {
      void import("@/lib/supabase").then(({ createSupabaseClient }) => {
        if (!cancelled) setSupabase(createSupabaseClient());
      });
      void getPostHog();
    };

    const requestIdle = window.requestIdleCallback;
    const cancelIdle = window.cancelIdleCallback;
    const idleHandle: number =
      typeof requestIdle === "function"
        ? requestIdle.call(window, loadSessionAndAnalytics, { timeout: 1200 })
        : window.setTimeout(loadSessionAndAnalytics, 0);

    return () => {
      cancelled = true;
      if (typeof cancelIdle === "function") {
        cancelIdle.call(window, idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
    };
  }, []);

  // Link PostHog identity to the signed-in Steam user, and reset on sign-out
  // so the next anonymous session doesn't inherit the previous distinct_id.
  useEffect(() => {
    if (!supabase) return;
    const apply = (user: { id: string; user_metadata?: Record<string, unknown> } | null) => {
      if (!user) {
        reset();
        return;
      }
      const meta = user.user_metadata ?? {};
      const steamId = typeof meta.steam_id === "string" ? meta.steam_id : null;
      if (!steamId) {
        // Steam OAuth callback always populates steam_id; if it's missing,
        // something is off — skip identify rather than create a person
        // keyed by the Supabase UUID that we'd later have to alias.
        return;
      }
      const steamName =
        typeof meta.steam_name === "string"
          ? meta.steam_name
          : typeof meta.full_name === "string"
            ? meta.full_name
            : null;
      const avatarUrl =
        typeof meta.avatar_url === "string" ? meta.avatar_url : null;
      const customUrl =
        typeof meta.custom_url === "string" ? meta.custom_url : null;
      identify(steamId, {
        // $-prefixed keys are PostHog reserved person properties — $name is
        // what the Persons list and dashboards display as the user's label.
        ...(steamName ? { $name: steamName } : {}),
        ...(steamName ? { steam_name: steamName } : {}),
        steam_id: steamId,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        ...(customUrl ? { custom_url: customUrl } : {}),
      });
    };
    supabase.auth.getUser().then(({ data }) => apply(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => apply(session?.user ?? null),
    );
    return () => subscription.unsubscribe();
  }, [supabase]);

  return (
    <>
      {process.env.NODE_ENV === "production" && (
        <BotIdClient protect={BOT_ID_PROTECTED_ROUTES} />
      )}
      <NavBar supabase={supabase} />
      <Component {...pageProps} supabase={supabase} />
      {shouldShowGlobalAd(router.pathname) && <BannerAd slot="bottom" />}
      <Footer />
      <Analytics beforeSend={redactAnalyticsEvent} />
      <SpeedInsights />
      <CookieConsentBanner />
      {pageProps?.draftMode && <SanityVisualEditing />}
    </>
  );
}
