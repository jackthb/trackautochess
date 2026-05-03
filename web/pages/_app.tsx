import "@/styles/globals.css";
import type { AppProps } from "next/app";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BotIdClient } from "botid/client";
import { BannerAd } from "@/components/BannerAd";
import { Footer } from "@/components/Footer";
import { NavBar } from "@/components/NavBar";
import { createSupabaseClient } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    setSupabase(createSupabaseClient());
  }, []);

  return (
    <>
      {process.env.NODE_ENV === "production" && (
        <BotIdClient protect={BOT_ID_PROTECTED_ROUTES} />
      )}
      <NavBar supabase={supabase} />
      <Component {...pageProps} supabase={supabase} />
      <BannerAd slot="bottom" />
      <Footer />
      <Analytics />
      <SpeedInsights />
      {pageProps?.draftMode && <SanityVisualEditing />}
    </>
  );
}
