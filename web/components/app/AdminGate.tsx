"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useAdminAccess } from "@/lib/admin";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { SteamSignInButton } from "@/components/SteamSignInButton";

/**
 * Client-side admin gate: PostHog `admin_access` flag. Real protection lives
 * in server-side auth checks.
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
  const { ready, steamId, user } = useSupabaseSession();
  const adminAccess = useAdminAccess(steamId);

  if (bypass) return <>{children}</>;
  if (!ready || adminAccess === "loading") return null;

  if (adminAccess === "enabled") {
    return <>{children}</>;
  }

  // Logged-in non-admin → 404. Signed-out → ask to sign in.
  if (user) notFound();

  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        Sign in with Steam to open this admin page.
      </p>
      <SteamSignInButton source="admin_gate" />
      <p style={{ marginTop: 16, fontSize: 13, opacity: 0.55 }}>
        Or go back to the <Link href="/">home page</Link>.
      </p>
    </div>
  );
}
