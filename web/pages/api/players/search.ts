import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSteamProfile,
  parseSteamInput,
  resolveSteamInput,
} from "@/lib/steam";

interface SearchResult {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  has_autochess_profile?: boolean;
  drodo_profile_missing?: boolean;
}

async function findAutoChessProfileIds(
  supabase: SupabaseClient | undefined,
  steamIds: string[]
): Promise<Set<string>> {
  if (!supabase || steamIds.length === 0) return new Set();

  const uniqueSteamIds = [...new Set(steamIds.map(String))];
  const [usersResult, seasonsResult, gamesResult] = await Promise.all([
    supabase
      .from("users")
      .select("steam_id, drodo_last_fetched_at, drodo_profile_missing")
      .in("steam_id", uniqueSteamIds),
    supabase.from("player_seasons").select("steam_id").in("steam_id", uniqueSteamIds),
    supabase.from("games").select("user_id").in("user_id", uniqueSteamIds),
  ]);

  const ids = new Set<string>();
  for (const row of usersResult.data ?? []) {
    if (row.drodo_last_fetched_at && !row.drodo_profile_missing) {
      ids.add(String(row.steam_id));
    }
  }
  for (const row of seasonsResult.data ?? []) ids.add(String(row.steam_id));
  for (const row of gamesResult.data ?? []) ids.add(String(row.user_id));
  return ids;
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

  const supabase =
    url && key
      ? createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : undefined;

  let rows: SearchResult[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("steam_id, name, custom_url")
      .or(`name.ilike.*${query}*,custom_url.ilike.*${query}*`)
      .limit(8);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    rows = (data ?? []) as SearchResult[];
  }

  const lower = query.toLowerCase();
  rows.sort((a, b) => {
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

  const parsed = parseSteamInput(query);
  if (parsed) {
    const resolvedSteamId = await resolveSteamInput(query, supabase, {
      persist: true,
    });
    if (
      resolvedSteamId &&
      !rows.some((row) => String(row.steam_id) === resolvedSteamId)
    ) {
      const profile = await fetchSteamProfile(resolvedSteamId, supabase, {
        persist: true,
      });
      rows.unshift({
        steam_id: resolvedSteamId,
        name: profile.name,
        custom_url:
          profile.customUrl ?? (parsed.kind === "slug" ? parsed.value : null),
      });
    }
  }

  const autoChessIds = await findAutoChessProfileIds(
    supabase,
    rows.map((row) => String(row.steam_id))
  );
  rows = rows.map((row) => ({
    ...row,
    has_autochess_profile: autoChessIds.has(String(row.steam_id)),
  }));

  return res.status(200).json(rows);
}
