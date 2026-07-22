import type { Metadata } from "next";
import { BetaFeaturesGate } from "@/components/app/BetaFeaturesGate";
import { GuideDetailClient } from "./GuideDetailClient";

interface Props {
  params: Promise<{ slug: string }>;
}

// Beta-flagged — see BetaFeaturesGate / website_beta_features. Admins bypass.
export const metadata: Metadata = {
  title: "Guide",
  robots: "noindex, nofollow",
};

export default async function GuideDetailPage({ params }: Props) {
  const { slug } = await params;
  return (
    <BetaFeaturesGate title="Guide">
      <GuideDetailClient slug={slug} />
    </BetaFeaturesGate>
  );
}
