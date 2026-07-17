import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { BuildDetailClient } from "./BuildDetailClient";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const title = `Build | ${SITE_TITLE}`;
  return {
    title,
    description: "Community Dota Auto Chess build",
    alternates: { canonical: `/builds/${id}` },
    openGraph: {
      title,
      description: "Community Dota Auto Chess build",
      type: "website",
      siteName: SITE_NAME,
      url: `/builds/${id}`,
      images: ["/logo.svg"],
    },
  };
}

export default async function BuildDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <PageLayout title="Build">
      <BuildDetailClient buildId={id} />
    </PageLayout>
  );
}
