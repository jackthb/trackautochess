import { NextResponse } from "next/server";
import { after } from "next/server";
import { loopbackDesktopReturnTo } from "@/lib/desktopReturnTo";
import { captureServerEvent } from "@/lib/posthogServer";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import {
  fetchSteamProfile,
  playerProfilePath,
  upsertSteamUser,
} from "@/lib/steam";
import { parseSteamId64, type SteamId64 } from "@dac/shared/steam";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_PROFILE_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

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
  if (!body.includes("is_valid:true")) return null;

  const claimed = query.get("openid.claimed_id") || "";
  const match = claimed.match(/\/id\/(\d+)$/);
  return match ? parseSteamId64(match[1]) : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const isDesktop = url.searchParams.get("desktop") === "1";
  const desktopReturnTo = loopbackDesktopReturnTo(
    url.searchParams.get("desktop_return_to")
  );
  const fail = (error: string, steamId?: string | null) => {
    if (steamId) {
      after(() =>
        captureServerEvent("Steam Sign In Failed", steamId, {
          source: "steam_auth_callback",
          reason: error,
        })
      );
    }

    if (desktopReturnTo) {
      return NextResponse.redirect(
        desktopRedirectUrl(desktopReturnTo, {
          error,
          steam_id: steamId,
        })
      );
    }

    if (isDesktop) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.redirect(new URL(`/?error=${error}`, req.url));
  };

  const steamId = await verifySteamAssertion(url.searchParams);
  if (!steamId) {
    return fail("steam_auth_failed");
  }
  const supabaseAdmin = createSupabaseServiceRoleClient();
  if (!supabaseAdmin) {
    console.error("Supabase service role is not configured");
    return fail("server_config_missing", steamId);
  }

  after(() =>
    captureServerEvent("Steam Sign In Callback Verified", steamId, {
      source: "steam_auth_callback",
    })
  );

  const steamProfile = await fetchSteamProfile(steamId, supabaseAdmin, {
    maxAgeMs: STEAM_PROFILE_REFRESH_INTERVAL_MS,
  }).catch((error) => {
    console.error("Failed to refresh Steam profile:", error);
    return { name: null, customUrl: null, avatarUrl: null };
  });
  const steamName = steamProfile.name || steamId;

  const email = `${steamId}@steam.local`;
  console.log("Steam verified:", steamId, steamName);

  // The public users upsert and the auth user lookup are independent. Auth
  // accounts are keyed by the synthetic email, so a SQL helper resolves the
  // user id directly instead of scanning auth.admin.listUsers pages (the old
  // page-1-only scan broke sign-in once the project outgrew 50 accounts).
  const [, lookup] = await Promise.all([
    upsertSteamUser(steamId, supabaseAdmin, {
      name: steamName === steamId ? null : steamName,
      customUrl: steamProfile.customUrl,
      avatarUrl: steamProfile.avatarUrl,
      steamSignedInAt: new Date().toISOString(),
    }),
    supabaseAdmin.rpc("auth_user_id_by_email", { p_email: email }),
  ]);
  if (lookup.error) {
    console.error("Failed to look up auth user:", lookup.error.message);
    return fail("user_lookup_failed", steamId);
  }
  const existingUserId = lookup.data ?? null;
  let userId = existingUserId;
  console.log("Existing user:", userId || "none");

  if (!userId) {
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
    userId = data.user.id;
    const createdUserId = userId;
    after(() =>
      captureServerEvent("user_signed_up", steamId, {
        source: "steam_auth",
        steam_id: steamId,
        steam_name: steamName,
        custom_url: steamProfile.customUrl,
        avatar_url: steamProfile.avatarUrl,
        user_id: createdUserId,
      })
    );
  } else {
    await supabaseAdmin.auth.admin.updateUserById(userId, {
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
  if (!verifyResp.ok) {
    console.error("Token verify failed:", verifyResp.status);
    return fail("session_failed", steamId);
  }

  const session = JSON.parse(verifyBody);
  if (!session.access_token || !session.refresh_token) {
    console.error("No tokens in verify response:", {
      hasAccessToken: Boolean(session.access_token),
      hasRefreshToken: Boolean(session.refresh_token),
      tokenType: typeof session.token_type,
      expiresIn: typeof session.expires_in,
    });
    return fail("session_failed", steamId);
  }

  const finalUserId = userId;
  after(() =>
    captureServerEvent("Steam Sign In Completed", steamId, {
      source: "steam_auth_callback",
      user_created: !existingUserId,
      has_custom_url: Boolean(steamProfile.customUrl),
      has_avatar: Boolean(steamProfile.avatarUrl),
      user_id: finalUserId,
    })
  );

  if (desktopReturnTo) {
    return NextResponse.redirect(
      desktopRedirectUrl(desktopReturnTo, {
        steam_id: steamId,
        steam_name: steamName,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at ?? null,
        expires_in: session.expires_in ?? null,
        token_type: session.token_type || "bearer",
      })
    );
  }

  if (isDesktop) {
    return NextResponse.json({
      steam_id: steamId,
      steam_name: steamName,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      expires_in: session.expires_in ?? null,
      token_type: session.token_type || "bearer",
    });
  }

  // Redirect with tokens in hash fragment — the shared Supabase client that
  // AppChrome creates on every page picks these up via detectSessionInUrl.
  // Land directly on the player profile instead of bouncing through the
  // /dashboard client redirect, which cost a full document load plus an auth
  // round trip before showing any content.
  const origin = url.origin;
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    token_type: session.token_type || "bearer",
    type: "magiclink",
  }).toString();

  return NextResponse.redirect(
    `${origin}${playerProfilePath(steamId, steamProfile.customUrl)}#${hash}`
  );
}


function desktopRedirectUrl(
  returnTo: string,
  params: Record<string, string | number | null | undefined>
) {
  const url = new URL(returnTo);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}
