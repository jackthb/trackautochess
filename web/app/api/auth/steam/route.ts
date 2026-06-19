import { NextResponse } from "next/server";
import { DEFAULT_SITE_URL, getSiteUrl } from "@/lib/site";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export function GET() {
  const origin = getSiteUrl() ?? DEFAULT_SITE_URL;
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
