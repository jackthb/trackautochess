"use client";

import { useEffect, useState, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { isAdminSteamId } from "@/lib/admin";
import { createSupabaseClient } from "@/lib/supabase";

type GateState = "loading" | "allowed" | "denied";

export function CreatorsGate({ children }: { children: ReactNode }) {
  const [steamId, setSteamId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      const sessionSteamId = user?.user_metadata?.steam_id;
      setSteamId(typeof sessionSteamId === "string" ? sessionSteamId : null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionSteamId = session?.user?.user_metadata?.steam_id;
      setSteamId(typeof sessionSteamId === "string" ? sessionSteamId : null);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const state: GateState = !authReady
    ? "loading"
    : isAdminSteamId(steamId)
      ? "allowed"
      : "denied";

  if (state === "loading") return null;
  if (state === "denied") notFound();

  return <>{children}</>;
}
