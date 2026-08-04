"use client";

import { useSessionFlags, type FlagAccess } from "@/lib/sessionFlags";

export type AdminAccess = FlagAccess;

/**
 * Client-side admin check via server-evaluated PostHog `admin_access`.
 *
 * Takes no steam id: `SessionFlagsProvider` already resolves the flag for the
 * signed-in Steam session and caches it per steamId, so there is no per-call
 * subject to pass. (This previously accepted a `steamId` and ignored it, which
 * read as a per-user check that never happened.)
 *
 * The chatbot beta rides this same flag — see `ChatWidget`.
 */
export function useAdminAccess(): AdminAccess {
  const { admin } = useSessionFlags();
  return admin;
}

export function useIsAdmin(): boolean {
  return useAdminAccess() === "enabled";
}
