import { requireAdminSession } from "@/lib/adminServer";
import { linkifyGuideBody } from "@/lib/guideLinks";
import { guidesBySlugData } from "@/generated/content-data";

interface Props {
  params: Promise<{ slug: string }>;
}

/** Admin-gated single guide. */
export async function GET(req: Request, { params }: Props) {
  const gate = await requireAdminSession(req);
  if (!gate.ok) return gate.response;

  const { slug } = await params;
  const guide = (guidesBySlugData as Record<string, { body?: string } | undefined>)[slug];
  if (!guide) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const linked =
    typeof guide.body === "string" ? { ...guide, body: linkifyGuideBody(guide.body) } : guide;

  return Response.json({ guide: linked });
}
