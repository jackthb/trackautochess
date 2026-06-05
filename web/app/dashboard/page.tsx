import type { Metadata } from "next";
import { SITE_TITLE } from "@/lib/site";
import { DashboardRedirect } from "./DashboardRedirect";

export const metadata: Metadata = {
  title: `Dashboard | ${SITE_TITLE}`,
  description: "Track Auto Chess dashboard.",
  robots: "noindex, nofollow",
  alternates: { canonical: "/dashboard" },
};

export default function DashboardPage() {
  return <DashboardRedirect />;
}
