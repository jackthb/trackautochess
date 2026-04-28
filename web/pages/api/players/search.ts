import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

interface SearchResult {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SearchResult[] | { error: string }>
) {
  const rawQuery = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const query = rawQuery?.trim().replace(/[,()%*]/g, "") ?? "";

  if (!query || query.length < 2) {
    return res.status(200).json([]);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return res.status(200).json([]);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("users")
    .select("steam_id, name, custom_url")
    .or(`name.ilike.*${query}*,custom_url.ilike.*${query}*`)
    .limit(8);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const lower = query.toLowerCase();
  const rows = ((data ?? []) as SearchResult[]).sort((a, b) => {
    const aExact =
      a.custom_url?.toLowerCase() === lower || a.name?.toLowerCase() === lower
        ? 0
        : 1;
    const bExact =
      b.custom_url?.toLowerCase() === lower || b.name?.toLowerCase() === lower
        ? 0
        : 1;
    return aExact - bExact;
  });

  return res.status(200).json(rows);
}
