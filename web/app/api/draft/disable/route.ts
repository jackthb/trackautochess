import { draftMode } from "next/headers";
import { partitionDraftCookie } from "@/lib/sanity/draftCookieApp";

// App Router migration of pages/api/draft/disable.ts.
export async function GET() {
  (await draftMode()).disable();
  // Match the attributes set on enable so the clearing cookie is accepted in
  // the cross-site Presentation iframe too.
  await partitionDraftCookie();
  return new Response(null, { status: 307, headers: { Location: "/" } });
}
