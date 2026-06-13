import type { Metadata } from "next";
import { SITE_TITLE } from "@/lib/site";
import { UsageDashboard } from "./UsageDashboard";

export const metadata: Metadata = {
  title: `Usage | ${SITE_TITLE}`,
  description: "Track Auto Chess operational usage dashboard.",
  robots: "noindex, nofollow",
  alternates: { canonical: "/dashboard/usage" },
};

export default function UsagePage() {
  return <UsageDashboard />;
}
