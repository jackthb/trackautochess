"use client";

import type { ReactNode } from "react";
import { useBetaFeaturesAccess } from "@/lib/betaFeatures";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import { PageLayout } from "@/components/PageLayout";

/**
 * Client gate for website beta pages (Matches, Builds, Guides, CMS).
 * Admins always pass via useBetaFeaturesAccess.
 */
export function BetaFeaturesGate({
  children,
  title,
  allowDevBypass = false,
  bare = false,
}: {
  children: ReactNode;
  title: string;
  /** Skip the auth check entirely in local development (e.g. Keystatic). */
  allowDevBypass?: boolean;
  /** Render children without PageLayout chrome (Keystatic owns its shell). */
  bare?: boolean;
}) {
  const bypass = allowDevBypass && process.env.NODE_ENV === "development";
  const { ready: authReady, steamId, accessToken } = useSupabaseSession();
  const betaAccess = useBetaFeaturesAccess(steamId);

  const wrap = (node: ReactNode) =>
    bare ? <>{node}</> : <PageLayout title={title}>{node}</PageLayout>;

  if (bypass) return <>{children}</>;

  if (!authReady || betaAccess === "loading") {
    return wrap(<div style={{ padding: "24px 0", opacity: 0.7 }}>Loading…</div>);
  }

  if (!accessToken || !steamId) {
    return wrap(
      <div style={{ padding: "32px 0", textAlign: "center" }}>
        <p style={{ marginBottom: 16, opacity: 0.8 }}>
          Sign in with Steam to view this beta page.
        </p>
        <SteamSignInButton source="beta_gate" size="sm" />
      </div>,
    );
  }

  if (betaAccess !== "enabled") {
    return wrap(
      <div style={{ padding: "24px 0", opacity: 0.8 }}>
        This page is restricted. Sign in with a beta-enabled Steam account to
        view it.
      </div>,
    );
  }

  return <>{children}</>;
}
