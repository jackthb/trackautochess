import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse, toApiReq } from "@/lib/abuseLog";

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

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as SupportRequest;
  if (body.company) {
    return Response.json({ ok: true });
  }

  const path = "/api/support";
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);
  const ua = getUserAgent(apiReq);

  const botCheck = await checkBotId({
    advancedOptions: { headers: Object.fromEntries(req.headers) },
  });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    logAbuse("bot_blocked", { path, ip, ua });
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    await rateLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip, ua });
    return Response.json(
      { ok: false, error: "Too many requests. Please wait before sending another message." },
      { status: 429 }
    );
  }

  const contact = clean(body.contact, 160);
  const message = clean(body.message, 1800);
  const page = clean(body.page, 240);

  if (!message || message.length < 20) {
    return Response.json(
      { ok: false, error: "Message must be at least 20 characters" },
      { status: 400 }
    );
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return Response.json(
      {
        ok: false,
        error: "Support webhook is not configured",
      },
      { status: 503 }
    );
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
              value: page || req.headers.get("referer") || "Unknown",
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
    return Response.json(
      {
        ok: false,
        error: "Discord webhook rejected the request",
      },
      { status: 502 }
    );
  }

  return Response.json({ ok: true });
}
