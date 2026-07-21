"use client";

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { useAdminAccess } from "@/lib/admin";
import { useSupabaseSession } from "@/lib/useSupabaseSession";

/**
 * Client-side admin gate: renders children only for signed-in admin Steam
 * accounts (PostHog `admin_access` flag), otherwise 404s. This is a UI
 * convenience — real protection lives in server-side auth checks. Used by
 * /keystatic, /guides, and /builds.
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
  const adminAccess = useAdminAccess(steamId);

  if (bypass) return <>{children}</>;
  if (!ready || adminAccess === "loading") return null;
  if (adminAccess !== "enabled") notFound();

  return <>{children}</>;
}
