import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SITE_TITLE } from "@/lib/site";

export const metadata: Metadata = {
  title: `Matches | ${SITE_TITLE}`,
  description: "Redirect to uploaded matches.",
  robots: "noindex, nofollow",
};

export default function MatchesRedirectPage() {
  redirect("/matches");
}
