/**
 * Shared bearer-token check for the Vercel cron routes.
 *
 * Both cron handlers opened with the same four lines against `CRON_SECRET`.
 * Keeping the check in one place means the "no secret configured ⇒ deny"
 * fail-closed behaviour can't drift between them.
 */

/** Returns a 401 to hand straight back, or null when the caller is authorized. */
export function requireCronAuth(req: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
