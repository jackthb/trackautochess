import type { Metadata } from "next";
import { AdminGate } from "@/components/app/AdminGate";
import { PageLayout } from "@/components/PageLayout";
import { BuildDetailClient } from "./BuildDetailClient";

type PageProps = { params: Promise<{ id: string }> };

// Admin-only — see AdminGate (PostHog `admin_access`).
export const metadata: Metadata = {
  title: "Build",
  robots: "noindex, nofollow",
};

export default async function BuildDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <AdminGate>
      <PageLayout title="Build">
        <BuildDetailClient buildId={id} />
      </PageLayout>
    </AdminGate>
  );
}
