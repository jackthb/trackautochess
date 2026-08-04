"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useAdminAccess } from "@/lib/admin";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import { PageLayout } from "@/components/PageLayout";

/**
 * Client-side admin gate: PostHog `admin_access`. Real protection lives in
 * server-side auth checks.
 */
export function AdminGate({
  children,
  title,
  allowDevBypass = false,
  bare = false,
}: {
  children: ReactNode;
  /** When set, wraps loading/denied UI in PageLayout. */
  title?: string;
  /** Skip the auth check entirely in local development (e.g. Keystatic). */
  allowDevBypass?: boolean;
  /** Render children without PageLayout chrome (Keystatic owns its shell). */
  bare?: boolean;
}) {
  const bypass = allowDevBypass && process.env.NODE_ENV === "development";
  const { ready, steamId, user, accessToken } = useSupabaseSession();
  const adminAccess = useAdminAccess();

  const wrap = (node: ReactNode) => {
    if (bare || !title) return <>{node}</>;
    return <PageLayout title={title}>{node}</PageLayout>;
  };

  if (bypass) return <>{children}</>;

  if (!ready || adminAccess === "loading") {
    return wrap(
      title ? (
        <div style={{ padding: "24px 0", opacity: 0.7 }}>Loading…</div>
      ) : null,
    );
  }

  if (adminAccess === "enabled") {
    return <>{children}</>;
  }

  if (user || (accessToken && steamId)) {
    if (title) {
      return wrap(
        <div style={{ padding: "24px 0", opacity: 0.8 }}>
          This page is restricted.
        </div>,
      );
    }
    notFound();
  }

  return wrap(
    <div style={{ padding: title ? "32px 0" : "48px 24px", textAlign: "center" }}>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        Sign in with Steam to open this admin page.
      </p>
      <SteamSignInButton source="admin_gate" size={title ? "sm" : undefined} />
      {!title && (
        <p style={{ marginTop: 16, fontSize: 13, opacity: 0.55 }}>
          Or go back to the <Link href="/">home page</Link>.
        </p>
      )}
    </div>,
  );
}
