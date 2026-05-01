import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BotIdClient } from "botid/client";
import { Footer } from "@/components/Footer";
import { NavBar } from "@/components/NavBar";
import { createSupabaseClient } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const BOT_ID_PROTECTED_ROUTES = [
  { path: "/api/drodo/*", method: "GET" },
  { path: "/api/drodo/*", method: "POST" },
  { path: "/api/players/search", method: "GET" },
  { path: "/api/support", method: "POST" },
];

export default function App({ Component, pageProps }: AppProps) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    // Only create the Supabase client on the browser side
    setSupabase(createSupabaseClient());
  }, []);

  return (
    <>
      {process.env.NODE_ENV === "production" && (
        <BotIdClient protect={BOT_ID_PROTECTED_ROUTES} />
      )}
      <NavBar supabase={supabase} />
      <Component {...pageProps} supabase={supabase} />
      <Footer />
      <Analytics />
      <SpeedInsights />
    </>
  );
}
