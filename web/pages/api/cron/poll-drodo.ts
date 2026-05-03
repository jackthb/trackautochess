import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchAndCacheDrodo } from "@/lib/drodo";

// Vercel cron sets Authorization: Bearer ${CRON_SECRET} when CRON_SECRET
// is configured in env. Reject anything else so the endpoint isn't a
// public Drodo-fetch trigger.
const POLL_BATCH_SIZE = 10;

interface DueUser {
  steam_id: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Database not configured" });
  }
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: dueUsers, error: queryError } = await supabase
    .from("users")
    .select("steam_id::text")
    .lte("next_poll_at", new Date().toISOString())
    .not("drodo_last_fetched_at", "is", null)
    .order("next_poll_at", { ascending: true })
    .limit(POLL_BATCH_SIZE);

  if (queryError) {
    return res.status(500).json({ error: queryError.message });
  }

  const ids = ((dueUsers ?? []) as unknown as DueUser[]).map((row) =>
    String(row.steam_id)
  );
  const results: Array<{
    steam_id: string;
    outcome: "ok" | "missing" | "upstream_error";
    error?: string;
  }> = [];

  for (const steamId of ids) {
    const result = await fetchAndCacheDrodo(steamId, supabase, {
      snapshotOnSuccess: true,
      pollMode: "adaptive",
    });
    if (result.ok) {
      results.push({ steam_id: steamId, outcome: "ok" });
    } else {
      results.push({
        steam_id: steamId,
        outcome: result.kind,
        error: result.error,
      });
    }
  }

  return res.status(200).json({
    polled: results.length,
    results,
  });
}
