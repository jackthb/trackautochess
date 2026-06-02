import type { NextApiRequest } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isBetaFeaturesEnabledForSteamId } from "@/lib/betaFeaturesServer";
import { getSessionUser } from "@/lib/sessionUser";

// Adapt a Web Request into the minimal NextApiRequest shape consumed by
// getSessionUser (it reads req.headers.authorization).
function toApiReq(req: Request): NextApiRequest {
  return {
    headers: { authorization: req.headers.get("authorization") ?? undefined },
  } as unknown as NextApiRequest;
}

interface LeaderboardRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_mmr_level: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
}

const LEADERBOARD_SELECT = [
  "steam_id::text",
  "name",
  "custom_url",
  "avatar_url",
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_mmr_level",
  "drodo_season",
  "drodo_season_games",
  "drodo_chicken_count",
].join(", ");

export async function GET(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase: SupabaseClient | null =
    supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey) : null;

  if (!supabase) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const session = await getSessionUser(toApiReq(req), supabase);
  if (!(await isBetaFeaturesEnabledForSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("users")
    .select(LEADERBOARD_SELECT)
    .not("drodo_last_fetched_at", "is", null)
    .eq("drodo_profile_missing", false)
    .order("drodo_mmr", { ascending: false, nullsFirst: false })
    .order("drodo_season_games", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as unknown as LeaderboardRow[]).map((row) => ({
    ...row,
    steam_id: String(row.steam_id),
  }));

  const seasonCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.drodo_mmr != null && row.drodo_season) {
      seasonCounts.set(row.drodo_season, (seasonCounts.get(row.drodo_season) ?? 0) + 1);
    }
  }
  let currentSeason: string | null = null;
  let max = 0;
  for (const [season, count] of seasonCounts) {
    if (count > max) {
      max = count;
      currentSeason = season;
    }
  }

  return Response.json({ rows, currentSeason });
}
