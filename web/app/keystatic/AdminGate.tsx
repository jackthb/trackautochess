"use client";

import { useEffect, useState } from "react";
import { isAdminSteamId } from "@/lib/admin";
import { createSupabaseClient } from "@/lib/supabase";
import KeystaticApp from "./keystatic";

type GateState = "loading" | "allowed" | "denied";

export default function AdminGate() {
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      const steamId = user?.user_metadata?.steam_id;
      setState(isAdminSteamId(typeof steamId === "string" ? steamId : null) ? "allowed" : "denied");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const steamId = session?.user?.user_metadata?.steam_id;
      setState(isAdminSteamId(typeof steamId === "string" ? steamId : null) ? "allowed" : "denied");
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (state === "loading") {
    return null;
  }

  if (state === "denied") {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>Not found</h1>
      </main>
    );
  }

  return <KeystaticApp />;
}
