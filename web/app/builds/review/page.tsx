import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SITE_TITLE } from "@/lib/site";
import { BuildReviewClient } from "./BuildReviewClient";

export const metadata: Metadata = {
  title: `Review builds | ${SITE_TITLE}`,
  robots: "noindex, nofollow",
};

export default function BuildReviewPage() {
  return (
    <PageLayout title="Review builds">
      <BuildReviewClient />
    </PageLayout>
  );
}
