"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { isAdminSteamId } from "@/lib/admin";
import { createSupabaseClient } from "@/lib/supabase";

const KeystaticApp = dynamic(() => import("./keystatic"), { ssr: false });

const DEV_BYPASS = process.env.NODE_ENV === "development";

type GateState = "loading" | "allowed" | "denied";

export default function AdminGate() {
  const [state, setState] = useState<GateState>(DEV_BYPASS ? "allowed" : "loading");

  useEffect(() => {
    if (DEV_BYPASS) return;

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

  if (state === "loading") return null;
  if (state === "denied") notFound();

  return <KeystaticApp />;
}
