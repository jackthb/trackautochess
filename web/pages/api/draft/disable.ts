import type { NextApiRequest, NextApiResponse } from "next";
import { partitionDraftCookie } from "@/lib/sanity/draftCookie";

export default function handler(
  _req: NextApiRequest,
  res: NextApiResponse<void>
): void {
  res.setDraftMode({ enable: false });
  // Match the attributes set on enable so the clearing cookie is accepted in
  // the cross-site Presentation iframe too.
  partitionDraftCookie(res);
  res.writeHead(307, { Location: "/" });
  res.end();
}
