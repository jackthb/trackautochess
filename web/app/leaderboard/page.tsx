import type { Metadata } from "next";
import { SITE_TITLE } from "@/lib/site";
import { LeaderboardClient } from "./LeaderboardClient";

// App Router migration of pages/leaderboard.tsx. The page is a Server Component
// that owns metadata and renders a "use client" island holding the admin gating,
// data fetching, and rendering. noindex carried over from the source's SeoHead.

export const metadata: Metadata = {
  title: `Leaderboard | ${SITE_TITLE}`,
  description: "Track Auto Chess admin leaderboard.",
  robots: "noindex, nofollow",
  alternates: { canonical: "/leaderboard" },
};

export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
