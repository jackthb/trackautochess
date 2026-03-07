import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export default function App({ Component, pageProps }: AppProps) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    // Only create the Supabase client on the browser side
    setSupabase(createSupabaseClient());
  }, []);

  return <Component {...pageProps} supabase={supabase} />;
}
