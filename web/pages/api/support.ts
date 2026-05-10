import type { NextApiRequest, NextApiResponse } from "next";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse } from "@/lib/abuseLog";

const rateLimiter = new RateLimiterMemory({
  points: 3,
  duration: 10 * 60,
});

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

  const path = "/api/support";
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  const botCheck = await checkBotId({ advancedOptions: { headers: req.headers } });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    logAbuse("bot_blocked", { path, ip, ua });
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    await rateLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip, ua });
    return res.status(429).json({ ok: false, error: "Too many requests. Please wait before sending another message." });
  }

  const contact = clean(body.contact, 160);
  const message = clean(body.message, 1800);
  const page = clean(body.page, 240);

  if (!message || message.length < 20) {
    return res.status(400).json({ ok: false, error: "Message must be at least 20 characters" });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
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
