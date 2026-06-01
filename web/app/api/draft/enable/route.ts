import { draftMode } from "next/headers";
import { validatePreviewUrl } from "@sanity/preview-url-secret";
import { tokenClient } from "@/lib/sanity/client";
import { partitionDraftCookie } from "@/lib/sanity/draftCookieApp";

// App Router migration of pages/api/draft/enable.ts. Validates the Sanity
// Presentation preview secret, enables draft mode, partitions the draft cookie
// for the cross-site Studio iframe, then redirects to the previewed path.
export async function GET(req: Request) {
  let validation;
  try {
    validation = await validatePreviewUrl(tokenClient(), req.url);
  } catch (err) {
    return Response.json({ message: (err as Error).message }, { status: 500 });
  }

  const { isValid, redirectTo = "/" } = validation;
  if (!isValid) {
    return Response.json({ message: "Invalid secret" }, { status: 401 });
  }

  (await draftMode()).enable();
  await partitionDraftCookie();

  return new Response(null, { status: 307, headers: { Location: redirectTo } });
}
