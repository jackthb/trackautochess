import type { Metadata } from "next";
import { SITE_TITLE } from "@/lib/site";
import { MatchesClient } from "./MatchesClient";

// Server Component for /matches. The client island owns beta gating, session
// lookup, data fetching, and rendering.

export const metadata: Metadata = {
  title: `Matches | ${SITE_TITLE}`,
  description: "All uploaded matches.",
  robots: "noindex, nofollow",
  alternates: { canonical: "/matches" },
};

export default function MatchesPage() {
  return <MatchesClient />;
}
