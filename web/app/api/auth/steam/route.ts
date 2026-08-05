import { NextResponse } from "next/server";
import { loopbackDesktopReturnTo } from "@/lib/desktopReturnTo";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const desktopReturnToParam = url.searchParams.get("desktop_return_to");
  const desktopReturnTo = desktopReturnToParam
    ? loopbackDesktopReturnTo(desktopReturnToParam)
    : null;
  if (desktopReturnToParam && !desktopReturnTo) {
    return NextResponse.json(
      { error: "invalid_desktop_return_to" },
      { status: 400 }
    );
  }
  const callbackUrl = new URL("/api/auth/steam/callback", origin);
  if (desktopReturnTo) {
    callbackUrl.searchParams.set("desktop_return_to", desktopReturnTo);
  }
  const returnTo = callbackUrl.toString();

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

