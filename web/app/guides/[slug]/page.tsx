import type { Metadata } from "next";
import { AdminGate } from "@/components/app/AdminGate";
import { GuideDetailClient } from "./GuideDetailClient";

interface Props {
  params: Promise<{ slug: string }>;
}

// Admin-only — see AdminGate. Deliberately no per-content SEO metadata and
// noindex, since this page (and the data it fetches from /api/guides/[slug])
// is not meant to be public yet.
export const metadata: Metadata = {
  title: "Guide",
  robots: "noindex, nofollow",
};

export default async function GuideDetailPage({ params }: Props) {
  const { slug } = await params;
  return (
    <AdminGate>
      <GuideDetailClient slug={slug} />
    </AdminGate>
  );
}
