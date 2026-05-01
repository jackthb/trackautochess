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

export default function App({ Component, pageProps }: AppProps) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    // Only create the Supabase client on the browser side
    setSupabase(createSupabaseClient());
  }, []);

  return (
    <>
      <BotIdClient
        protect={[
          { path: "/api/drodo/*", method: "GET" },
          { path: "/api/players/search", method: "GET" },
          { path: "/api/support", method: "POST" },
        ]}
      />
      <NavBar supabase={supabase} />
      <Component {...pageProps} supabase={supabase} />
      <Footer />
      <Analytics />
      <SpeedInsights />
    </>
  );
}
