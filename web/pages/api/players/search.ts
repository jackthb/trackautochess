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
  has_games?: boolean;
  drodo_profile_missing?: boolean;
}

interface UserSearchRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  drodo_last_fetched_at: string | null;
  drodo_profile_missing: boolean | null;
}

const USER_SEARCH_SELECT =
  "steam_id::text, name, custom_url, drodo_last_fetched_at, drodo_profile_missing";

function toSearchResult(row: UserSearchRow): SearchResult {
  return {
    steam_id: String(row.steam_id),
    name: row.name,
    custom_url: row.custom_url,
    has_autochess_profile: Boolean(
      row.drodo_last_fetched_at && !row.drodo_profile_missing
    ),
    has_games: false,
    drodo_profile_missing: Boolean(row.drodo_profile_missing),
  };
}

function rankSearchResult(row: SearchResult): number {
  if (row.has_autochess_profile) return 0;
  if (row.has_games) return 1;
  if (!row.drodo_profile_missing) return 2;
  return 3;
}

function exactSearchRank(row: SearchResult, query: string): number {
  const lower = query.toLowerCase();
  if (row.custom_url?.toLowerCase() === lower) return 0;
  if (row.name?.toLowerCase() === lower) return 1;
  return 2;
}

function sortSearchResults(rows: SearchResult[], query: string): SearchResult[] {
  return [...rows].sort(
    (a, b) =>
      rankSearchResult(a) - rankSearchResult(b) ||
      exactSearchRank(a, query) - exactSearchRank(b, query) ||
      String(a.custom_url || "").localeCompare(String(b.custom_url || "")) ||
      String(a.steam_id).localeCompare(String(b.steam_id))
  );
}

function mergeSearchResults(rows: SearchResult[]): SearchResult[] {
  const merged = new Map<string, SearchResult>();
  for (const row of rows) {
    const existing = merged.get(row.steam_id);
    if (!existing) {
      merged.set(row.steam_id, row);
      continue;
    }
    merged.set(row.steam_id, {
      steam_id: row.steam_id,
      name: existing.name || row.name,
      custom_url: existing.custom_url || row.custom_url,
      has_autochess_profile:
        Boolean(existing.has_autochess_profile) || Boolean(row.has_autochess_profile),
      has_games: Boolean(existing.has_games) || Boolean(row.has_games),
      drodo_profile_missing:
        Boolean(existing.drodo_profile_missing) && Boolean(row.drodo_profile_missing),
    });
  }
  return [...merged.values()];
}

async function markRowsWithGames(
  supabase: SupabaseClient,
  rows: SearchResult[]
): Promise<SearchResult[]> {
  const ids = [...new Set(rows.map((row) => row.steam_id))];
  if (ids.length === 0) return rows;

  const { data } = await supabase
    .from("games")
    .select("user_id::text")
    .in("user_id", ids)
    .limit(1000);

  const idsWithGames = new Set(
    ((data ?? []) as Array<{ user_id: string }>).map((row) =>
      String(row.user_id)
    )
  );

  return rows.map((row) => ({
    ...row,
    has_games: row.has_games || idsWithGames.has(row.steam_id),
  }));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SearchResult[] | { error: string }>
) {
  const rawQuery = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const query = rawQuery?.trim().replace(/[,()%*]/g, "") ?? "";
  const shouldSearchSteam = req.query.steam === "1";

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
    const candidateRows: SearchResult[] = [];

    const exactCustom = await supabase
      .from("users")
      .select(USER_SEARCH_SELECT)
      .ilike("custom_url", query)
      .limit(8);

    if (exactCustom.error) {
      return res.status(500).json({ error: exactCustom.error.message });
    }

    candidateRows.push(
      ...((exactCustom.data ?? []) as UserSearchRow[]).map(toSearchResult)
    );

    if (/^\d+$/.test(query)) {
      const exactSteamId = await supabase
        .from("users")
        .select(USER_SEARCH_SELECT)
        .eq("steam_id", query)
        .limit(1);

      if (exactSteamId.error) {
        return res.status(500).json({ error: exactSteamId.error.message });
      }

      candidateRows.push(
        ...((exactSteamId.data ?? []) as UserSearchRow[]).map(toSearchResult)
      );
    }

    const prefixCustom = await supabase
      .from("users")
      .select(USER_SEARCH_SELECT)
      .ilike("custom_url", `${query}%`)
      .limit(8);

    if (prefixCustom.error) {
      return res.status(500).json({ error: prefixCustom.error.message });
    }

    candidateRows.push(
      ...((prefixCustom.data ?? []) as UserSearchRow[]).map(toSearchResult)
    );

    rows = sortSearchResults(
      await markRowsWithGames(supabase, mergeSearchResults(candidateRows)),
      query
    );
  }

  const parsed = parseSteamInput(query);
  let authoritativeSteamId: string | null = null;
  if (parsed && shouldSearchSteam) {
    const resolvedSteamId = await resolveSteamInput(query, supabase, {
      persist: false,
    });
    authoritativeSteamId = resolvedSteamId;
    if (
      resolvedSteamId &&
      !rows.some((row) => String(row.steam_id) === resolvedSteamId)
    ) {
      const profile = await fetchSteamProfile(resolvedSteamId, supabase, {
        persist: false,
      });
      rows.unshift({
        steam_id: resolvedSteamId,
        name: profile.name,
        custom_url: profile.customUrl ?? (parsed.kind === "slug" ? parsed.value : null),
        has_autochess_profile: false,
        drodo_profile_missing: false,
      });
    }
  }

  rows = sortSearchResults(mergeSearchResults(rows), query);
  if (authoritativeSteamId) {
    const authoritative = rows.find(
      (row) => String(row.steam_id) === authoritativeSteamId
    );
    if (authoritative) {
      rows = [
        authoritative,
        ...rows.filter((row) => String(row.steam_id) !== authoritativeSteamId),
      ];
    }
  }

  return res.status(200).json(rows);
}
