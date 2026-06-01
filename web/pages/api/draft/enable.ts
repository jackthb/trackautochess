import type { NextApiRequest, NextApiResponse } from "next";
import { validatePreviewUrl } from "@sanity/preview-url-secret";
import { tokenClient } from "@/lib/sanity/client";
import { partitionDraftCookie } from "@/lib/sanity/draftCookie";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!req.url) {
    return res.status(500).json({ message: "Missing request URL" });
  }

  let validation;
  try {
    validation = await validatePreviewUrl(tokenClient(), req.url);
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }

  const { isValid, redirectTo = "/" } = validation;

  if (!isValid) {
    return res.status(401).json({ message: "Invalid secret" });
  }

  res.setDraftMode({ enable: true });
  partitionDraftCookie(res);
  res.writeHead(307, { Location: redirectTo });
  res.end();
}
