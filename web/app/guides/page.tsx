import type { Metadata } from "next";
import { AdminGate } from "@/components/app/AdminGate";
import { GuidesIndexClient } from "./GuidesIndexClient";

// Admin-only — see AdminGate. Deliberately no per-content SEO metadata and
// noindex, since this page (and the data it fetches from /api/guides) is not
// meant to be public yet.
export const metadata: Metadata = {
  title: "Guides",
  robots: "noindex, nofollow",
};

export default function GuidesIndexPage() {
  return (
    <AdminGate>
      <GuidesIndexClient />
    </AdminGate>
  );
}
