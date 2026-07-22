import type { Metadata } from "next";
import { AdminGate } from "@/components/app/AdminGate";
import { GuidesIndexClient } from "./GuidesIndexClient";

export const metadata: Metadata = {
  title: "Guides",
  robots: "noindex, nofollow",
};

export default function GuidesIndexPage() {
  return (
    <AdminGate title="Guides">
      <GuidesIndexClient />
    </AdminGate>
  );
}
