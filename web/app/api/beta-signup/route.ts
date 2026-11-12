import { RateLimiterMemory } from "rate-limiter-flexible";
import { openApiRoute } from "@/lib/apiGuard";
import { captureServerEvent } from "@/lib/posthogServer";
import { cleanField } from "@/lib/text";

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

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as BetaSignupRequest;
  if (body.company) {
    return Response.json({ ok: true });
  }

  const gate = await openApiRoute(req, {
    path: "/api/beta-signup",
    limiter: rateLimiter,
    okFlag: true,
    rateLimitMessage:
      "Too many signups from this connection. Try again later.",
  });
  if (!gate.ok) return gate.response;

  const email = cleanField(body.email, 254).toLowerCase();
  const source = cleanField(body.source, 64) || "unknown";

  if (!EMAIL_PATTERN.test(email)) {
    return Response.json(
      { ok: false, error: "Enter a valid email address." },
      { status: 400 }
    );
  }

  const accepted = await captureServerEvent(
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

  if (!accepted) {
    return Response.json(
      { ok: false, error: "We couldn't save your signup. Please try again shortly." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
  return Response.json({ ok: true });
}
