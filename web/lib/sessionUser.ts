import type { NextApiRequest } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedSteamIdentity } from "./verifiedSteamIdentity";

export interface SessionUser {
  steamId: string | null;
}

function extractAccessToken(req: NextApiRequest): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  return null;
}

export async function getSessionUser(
  req: NextApiRequest,
  supabase: SupabaseClient | null
): Promise<SessionUser> {
  if (!supabase) return { steamId: null };
  const token = extractAccessToken(req);
  if (!token) return { steamId: null };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { steamId: null };
  return { steamId: verifiedSteamIdentity(data.user) };
}
