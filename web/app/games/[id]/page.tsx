import { permanentRedirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GameRedirectPage({ params }: PageProps) {
  const { id } = await params;
  permanentRedirect(`/matches/${id}`);
}
