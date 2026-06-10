import { NextResponse } from "next/server";
import { captureServerEvent } from "@/lib/posthogServer";
import { createSupabaseServiceRoleClientOrThrow } from "@/lib/supabase";
import {
  fetchSteamProfileFromApi,
  upsertSteamUser,
} from "@/lib/steam";
import { parseSteamId64, type SteamId64 } from "@dac/shared/steam";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

async function verifySteamAssertion(
  query: URLSearchParams
): Promise<SteamId64 | null> {
  const params = new URLSearchParams();
  for (const [key, val] of query.entries()) {
    if (key.startsWith("openid.")) {
      params.set(key, val);
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

  const claimed = query.get("openid.claimed_id") || "";
  const match = claimed.match(/\/id\/(\d+)$/);
  return match ? parseSteamId64(match[1]) : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = async (error: string, steamId?: string | null) => {
    if (steamId) {
      await captureServerEvent("Steam Sign In Failed", steamId, {
        source: "steam_auth_callback",
        reason: error,
      });
    }

    return NextResponse.redirect(new URL(`/?error=${error}`, req.url));
  };

  const steamId = await verifySteamAssertion(url.searchParams);
  if (!steamId) {
    return fail("steam_auth_failed");
  }

  await captureServerEvent("Steam Sign In Callback Verified", steamId, {
    source: "steam_auth_callback",
  });

  const steamProfile = await fetchSteamProfileFromApi(steamId);
  const steamName = steamProfile.name || steamId;

  const supabaseAdmin = createSupabaseServiceRoleClientOrThrow();

  const email = `${steamId}@steam.local`;
  console.log("Steam verified:", steamId, steamName);

  // Persist Steam display name in the public users table
  await upsertSteamUser(steamId, supabaseAdmin, {
    name: steamName === steamId ? null : steamName,
    customUrl: steamProfile.customUrl,
    avatarUrl: steamProfile.avatarUrl,
    steamSignedInAt: new Date().toISOString(),
  });

  // Find or create user
  const { data: users, error: listError } =
    await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    console.error("Failed to list users:", listError.message);
    return fail("list_users_failed", steamId);
  }
  const existingUser = users?.users?.find((u) => u.email === email);
  let user = existingUser;
  console.log("Existing user:", user?.id || "none");

  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        steam_id: steamId,
        steam_name: steamName,
        custom_url: steamProfile.customUrl,
        avatar_url: steamProfile.avatarUrl,
        full_name: steamName,
      },
    });
    if (error) {
      console.error("Failed to create user:", error.message);
      return fail("user_creation_failed", steamId);
    }
    user = data.user;
    await captureServerEvent("user_signed_up", steamId, {
      source: "steam_auth",
      steam_id: steamId,
      steam_name: steamName,
      custom_url: steamProfile.customUrl,
      avatar_url: steamProfile.avatarUrl,
      user_id: user.id,
    });
  } else {
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        steam_id: steamId,
        steam_name: steamName,
        custom_url: steamProfile.customUrl,
        avatar_url: steamProfile.avatarUrl,
        full_name: steamName,
      },
    });
  }

  // Generate a magic link and extract the token
  const { data: linkData, error: linkError } =
    await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });

  console.log(
    "generateLink result:",
    linkError?.message || "ok",
    linkData?.properties?.hashed_token ? "has token" : "no token"
  );
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("Failed to generate link:", linkError?.message);
    return fail("session_failed", steamId);
  }

  // Verify the token server-side to get a session
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const verifyResp = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
    return fail("session_failed", steamId);
  }

  const session = JSON.parse(verifyBody);
  if (!session.access_token || !session.refresh_token) {
    console.error("No tokens in verify response:", JSON.stringify(session));
    return fail("session_failed", steamId);
  }

  await captureServerEvent("Steam Sign In Completed", steamId, {
    source: "steam_auth_callback",
    user_created: !existingUser,
    has_custom_url: Boolean(steamProfile.customUrl),
    has_avatar: Boolean(steamProfile.avatarUrl),
    user_id: user.id,
  });

  // Redirect with tokens in hash fragment — Supabase JS client picks these up
  // automatically via onAuthStateChange.
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const origin = `${proto}://${host}`;
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    token_type: session.token_type || "bearer",
    type: "magiclink",
  }).toString();

  return NextResponse.redirect(`${origin}/dashboard#${hash}`);
}
