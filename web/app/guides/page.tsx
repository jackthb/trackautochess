import type { Metadata } from "next";
import { BetaFeaturesGate } from "@/components/app/BetaFeaturesGate";
import { GuidesIndexClient } from "./GuidesIndexClient";

// Beta-flagged — see BetaFeaturesGate / website_beta_features. Admins bypass.
export const metadata: Metadata = {
  title: "Guides",
  robots: "noindex, nofollow",
};

export default function GuidesIndexPage() {
  return (
    <BetaFeaturesGate title="Guides">
      <GuidesIndexClient />
    </BetaFeaturesGate>
  );
}
