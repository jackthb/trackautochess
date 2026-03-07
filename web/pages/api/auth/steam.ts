import type { NextApiRequest, NextApiResponse } from "next";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const returnTo = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/auth/steam/callback`;

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  res.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
}
