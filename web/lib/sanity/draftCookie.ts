import type { NextApiResponse } from "next";

// Next.js stores draft-mode state in this cookie. Its presence is what makes
// `context.draftMode` (and our `pageProps.draftMode`) true.
const DRAFT_COOKIE = "__prerender_bypass";

/**
 * Re-stamp Next.js's draft-mode cookie so it survives a cross-site iframe.
 *
 * Our Studio is hosted by Sanity at www.sanity.io and embeds the live site
 * (a different origin) inside the Presentation tool's iframe. Next's
 * `setDraftMode` cookie isn't delivered in that third-party context under
 * Chrome's 3p-cookie phase-out or Firefox/Zen Total Cookie Protection unless
 * it's partitioned — so draft mode silently never turns on and visual editing
 * reports "Unable to connect to visual editing". Adding
 * `SameSite=None; Secure; Partitioned` (CHIPS) fixes delivery without touching
 * the signed value Next generated.
 *
 * Only applied in production: the Secure attribute would prevent the cookie
 * from being stored over http://localhost, and local dev uses a same-site
 * Studio where Next's default (SameSite=Lax) already works.
 */
export function partitionDraftCookie(res: NextApiResponse): void {
  if (process.env.NODE_ENV !== "production") return;

  const header = res.getHeader("Set-Cookie");
  if (!header) return;

  const cookies = (Array.isArray(header) ? header : [String(header)]).map(
    (cookie) =>
      cookie.startsWith(`${DRAFT_COOKIE}=`) ? crossSiteAttributes(cookie) : cookie
  );

  res.setHeader("Set-Cookie", cookies);
}

// Drop whatever SameSite/Secure/Partitioned Next added, then re-add the exact
// combination a partitioned third-party cookie requires.
function crossSiteAttributes(cookie: string): string {
  const base = cookie
    .replace(/;\s*SameSite=[^;]*/gi, "")
    .replace(/;\s*Secure/gi, "")
    .replace(/;\s*Partitioned/gi, "");
  return `${base}; SameSite=None; Secure; Partitioned`;
}
