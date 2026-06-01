import type { Metadata } from "next";
import { SITE_TITLE } from "@/lib/site";
import { DashboardRedirect } from "./DashboardRedirect";

// App Router migration of pages/dashboard.tsx. Template for client-auth pages:
// the page is a Server Component that owns metadata and renders a "use client"
// island for the auth/redirect logic.

export const metadata: Metadata = {
  title: `Dashboard | ${SITE_TITLE}`,
  description: "Track Auto Chess dashboard.",
  robots: "noindex, nofollow",
  alternates: { canonical: "/dashboard" },
};

export default function DashboardPage() {
  return <DashboardRedirect />;
}
