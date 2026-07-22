import { useEffect, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { normalizeSteamId64 } from "@/lib/admin";

/**
 * Shared browser auth-session state. Loads the singleton Supabase client
 * (dynamically, so supabase-js stays out of the initial bundle), resolves the
 * current session, and subscribes to auth-state changes.
 */
export interface SupabaseSessionState {
  /** Browser Supabase client; null while loading or when env config is missing. */
  supabase: SupabaseClient | null;
  session: Session | null;
  user: User | null;
  /** Steam ID64 from user_metadata when signed in via Steam. */
  steamId: string | null;
  /** Steam vanity URL from user_metadata, when known. */
  customUrl: string | null;
  accessToken: string | null;
  /** True once the initial session lookup (or missing-config bail) resolved. */
  ready: boolean;
}

function metadataString(user: User | null, key: string): string | null {
  const value = user?.user_metadata?.[key];
  return typeof value === "string" ? value : null;
}

export function useSupabaseSession(): SupabaseSessionState {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void import("@/lib/supabase").then(({ createSupabaseClient }) => {
      if (cancelled) return;
      const client = createSupabaseClient();
      setSupabase(client);
      if (!client) {
        setReady(true);
        return;
      }

      client.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        setSession(data.session ?? null);
        setReady(true);
      });

      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession ?? null);
        setReady(true);
      });
      unsubscribe = () => subscription.unsubscribe();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const user = session?.user ?? null;
  return {
    supabase,
    session,
    user,
    steamId: normalizeSteamId64(user?.user_metadata?.steam_id),
    customUrl: metadataString(user, "custom_url"),
    accessToken: session?.access_token ?? null,
    ready,
  };
}
