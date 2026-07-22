"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdminSteamId } from "@/lib/admin";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { SteamSignInButton } from "@/components/SteamSignInButton";

/**
 * Client-side admin gate: renders children only for signed-in admin Steam
 * accounts. Real protection lives in server-side auth/RLS.
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

  if (bypass) return <>{children}</>;
  if (!ready) return null;

  if (isAdminSteamId(steamId)) {
    return <>{children}</>;
  }

  // Logged-in non-admin → 404. Signed-out → ask to sign in (don't pretend
  // the page doesn't exist when the real issue is auth).
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
