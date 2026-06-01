import { NextResponse } from "next/server";

// App Router migration of pages/api/auth/steam.ts — kicks off Steam OpenID login.
const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export function GET(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const origin = `${proto}://${host}`;
  const returnTo = `${origin}/api/auth/steam/callback`;

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": origin,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  return NextResponse.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
}
