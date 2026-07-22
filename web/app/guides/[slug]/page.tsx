import type { Metadata } from "next";
import { AdminGate } from "@/components/app/AdminGate";
import { GuideDetailClient } from "./GuideDetailClient";

interface Props {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  title: "Guide",
  robots: "noindex, nofollow",
};

export default async function GuideDetailPage({ params }: Props) {
  const { slug } = await params;
  return (
    <AdminGate title="Guide">
      <GuideDetailClient slug={slug} />
    </AdminGate>
  );
}
