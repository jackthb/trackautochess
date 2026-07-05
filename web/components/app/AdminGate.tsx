"use client";

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isAdminSteamId } from "@/lib/admin";
import { useSupabaseSession } from "@/lib/useSupabaseSession";

/**
 * Client-side admin gate: renders children only for signed-in admin Steam
 * accounts, otherwise 404s. This is a UI convenience — real protection lives
 * in server-side auth/RLS. Used by /keystatic and /builds.
 */
export function AdminGate({
  children,
  allowDevBypass = false,
}: {
  children: ReactNode;
  /** Skip the auth check entirely in local development (e.g. Keystatic). */
  allowDevBypass?: boolean;
}) {
  const bypass = allowDevBypass && process.env.NODE_ENV === "development";
  const { ready, steamId } = useSupabaseSession();

  if (bypass) return <>{children}</>;
  if (!ready) return null;
  if (!isAdminSteamId(steamId)) notFound();

  return <>{children}</>;
}
