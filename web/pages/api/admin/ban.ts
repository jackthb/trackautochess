import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdminSteamId } from "@/lib/admin";
import { getSessionUser } from "@/lib/sessionUser";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Database not configured" });
  }

  const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const session = await getSessionUser(req, supabaseAdmin);
  if (!isAdminSteamId(session.steamId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { steam_id, banned } = (req.body ?? {}) as {
    steam_id?: unknown;
    banned?: unknown;
  };
  if (typeof steam_id !== "string" || !/^\d+$/.test(steam_id)) {
    return res.status(400).json({ error: "Invalid steam_id" });
  }
  if (typeof banned !== "boolean") {
    return res.status(400).json({ error: "banned must be boolean" });
  }
  if (steam_id === session.steamId) {
    return res.status(400).json({ error: "Cannot ban yourself" });
  }

  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({ banned })
    .eq("steam_id", steam_id);

  if (updateError) {
    return res.status(500).json({ error: updateError.message });
  }

  if (banned) {
    // Kill any existing Supabase session so the ban takes effect immediately.
    const email = `${steam_id}@steam.local`;
    const { data: list } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = list?.users?.find((u) => u.email === email);
    if (authUser) {
      await supabaseAdmin.auth.admin.signOut(authUser.id);
    }
  }

  return res.status(200).json({ steam_id, banned });
}
