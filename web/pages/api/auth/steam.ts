import type { NextApiRequest, NextApiResponse } from "next";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
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

  res.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
}
