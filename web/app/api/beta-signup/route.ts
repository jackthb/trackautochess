import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse, toApiReq } from "@/lib/abuseLog";
import { captureServerEvent } from "@/lib/posthogServer";

/**
 * Pre-release beta waitlist.
 *
 * The email is stored in PostHog rather than in our own table: capturing
 * server-side with `distinct_id = <email>` creates a person profile carrying
 * an `email` property, so the list is queryable as a cohort
 * (`beta_waitlist = true`) and can be mailed from PostHog when the tracker
 * ships. Nothing here writes to Supabase.
 */

const rateLimiter = new RateLimiterMemory({
  points: 5,
  duration: 10 * 60,
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface BetaSignupRequest {
  email?: string;
  source?: string;
  /** Honeypot — bots fill it, humans never see it. */
  company?: string;
}

function clean(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as BetaSignupRequest;
  if (body.company) {
    return Response.json({ ok: true });
  }

  const path = "/api/beta-signup";
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
      { ok: false, error: "Too many signups from this connection. Try again later." },
      { status: 429 }
    );
  }

  const email = clean(body.email, 254).toLowerCase();
  const source = clean(body.source, 64) || "unknown";

  if (!EMAIL_PATTERN.test(email)) {
    return Response.json(
      { ok: false, error: "Enter a valid email address." },
      { status: 400 }
    );
  }

  await captureServerEvent(
    "Beta Waitlist Joined",
    email,
    { source },
    {
      personProperties: {
        email,
        beta_waitlist: true,
        beta_waitlist_source: source,
      },
      personPropertiesOnce: {
        beta_waitlist_joined_at: new Date().toISOString(),
      },
    }
  );

  return Response.json({ ok: true });
}
