import type { NextApiRequest, NextApiResponse } from "next";

interface SupportRequest {
  contact?: string;
  message?: string;
  page?: string;
  company?: string;
}

function clean(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: boolean; error?: string }>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as SupportRequest;
  if (body.company) {
    return res.status(200).json({ ok: true });
  }

  const contact = clean(body.contact, 160);
  const message = clean(body.message, 1800);
  const page = clean(body.page, 240);

  if (!message) {
    return res.status(400).json({ ok: false, error: "Message is required" });
  }

  const webhookUrl = process.env.DISCORD_SUPPORT_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(503).json({
      ok: false,
      error: "Support webhook is not configured",
    });
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Track Auto Chess Support",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "Support request",
          color: 0xc94f3d,
          timestamp: new Date().toISOString(),
          fields: [
            {
              name: "Contact",
              value: contact || "Not provided",
              inline: false,
            },
            {
              name: "Page",
              value: page || req.headers.referer || "Unknown",
              inline: false,
            },
            {
              name: "Message",
              value: truncate(message, 1024),
              inline: false,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    return res.status(502).json({
      ok: false,
      error: "Discord webhook rejected the request",
    });
  }

  return res.status(200).json({ ok: true });
}
