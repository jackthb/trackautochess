import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import {
  fetchSteamProfileFromApi,
  upsertSteamUser,
} from "../../../../lib/steam";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

async function verifySteamAssertion(query: Record<string, string | string[] | undefined>): Promise<string | null> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (key.startsWith("openid.")) {
      params.set(key, Array.isArray(val) ? val[0] : val || "");
    }
  }
  params.set("openid.mode", "check_authentication");

  const resp = await fetch(STEAM_OPENID_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = await resp.text();
  console.log("Steam verify response:", body);
  if (!body.includes("is_valid:true")) return null;

  const claimed = (query["openid.claimed_id"] as string) || "";
  const match = claimed.match(/\/id\/(\d+)$/);
  return match ? match[1] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const steamId = await verifySteamAssertion(req.query);
  if (!steamId) {
    return res.redirect("/?error=steam_auth_failed");
  }

  const steamProfile = await fetchSteamProfileFromApi(steamId);
  const steamName = steamProfile.name || steamId;

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const email = `${steamId}@steam.local`;
  console.log("Steam verified:", steamId, steamName);

  // Persist Steam display name in the public users table
  await upsertSteamUser(steamId, supabaseAdmin, {
    name: steamName === steamId ? null : steamName,
    customUrl: steamProfile.customUrl,
  });

  // Find or create user
  const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    console.error("Failed to list users:", listError.message);
    return res.redirect("/?error=list_users_failed");
  }
  let user = users?.users?.find((u) => u.email === email);
  console.log("Existing user:", user?.id || "none");

  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        steam_id: steamId,
        steam_name: steamName,
        custom_url: steamProfile.customUrl,
        full_name: steamName,
      },
    });
    if (error) {
      console.error("Failed to create user:", error.message);
      return res.redirect("/?error=user_creation_failed");
    }
    user = data.user;
  } else {
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        steam_id: steamId,
        steam_name: steamName,
        custom_url: steamProfile.customUrl,
        full_name: steamName,
      },
    });
  }

  // Generate a magic link and extract the token
  const { data: linkData, error: linkError } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

  console.log("generateLink result:", linkError?.message || "ok", linkData?.properties?.hashed_token ? "has token" : "no token");
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("Failed to generate link:", linkError?.message);
    return res.redirect("/?error=session_failed");
  }

  // Verify the token server-side to get a session
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const verifyResp = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    }),
  });

  const verifyBody = await verifyResp.text();
  console.log("Verify response:", verifyResp.status, verifyBody.substring(0, 300));
  if (!verifyResp.ok) {
    console.error("Token verify failed:", verifyResp.status, verifyBody);
    return res.redirect("/?error=session_failed");
  }

  const session = JSON.parse(verifyBody);

  if (!session.access_token || !session.refresh_token) {
    console.error("No tokens in verify response:", JSON.stringify(session));
    return res.redirect("/?error=session_failed");
  }

  // Redirect with tokens in hash fragment — Supabase JS client picks these up
  // automatically via onAuthStateChange
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const origin = `${proto}://${host}`;
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    token_type: session.token_type || "bearer",
    type: "magiclink",
  }).toString();

  res.redirect(`${origin}/dashboard#${hash}`);
}
