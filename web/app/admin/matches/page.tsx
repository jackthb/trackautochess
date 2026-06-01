import type { Metadata } from "next";
import { SITE_TITLE } from "@/lib/site";
import { AdminMatchesClient } from "./AdminMatchesClient";

// App Router migration of pages/admin/matches.tsx. The page is a Server
// Component that owns metadata and renders a "use client" island holding all
// the admin-gating, data-fetching, and rendering logic.

export const metadata: Metadata = {
  title: `Matches | ${SITE_TITLE}`,
  description: "All uploaded matches.",
  robots: "noindex, nofollow",
  alternates: { canonical: "/admin/matches" },
};

export default function AdminMatchesPage() {
  return <AdminMatchesClient />;
}
