import type { SupabaseClient } from "@supabase/supabase-js";

export interface SearchResult {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  has_autochess_profile?: boolean;
  has_games?: boolean;
  drodo_profile_missing?: boolean;
}

export interface UserSearchRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  drodo_last_fetched_at: string | null;
  drodo_profile_missing: boolean | null;
}

export const USER_SEARCH_SELECT =
  "steam_id::text, name, custom_url, drodo_last_fetched_at, drodo_profile_missing";

export function toSearchResult(row: UserSearchRow): SearchResult {
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
  if (row.steam_id === query) return 2;
  return 3;
}

export function sortSearchResults(
  rows: SearchResult[],
  query = ""
): SearchResult[] {
  return [...rows].sort(
    (a, b) =>
      rankSearchResult(a) - rankSearchResult(b) ||
      exactSearchRank(a, query) - exactSearchRank(b, query) ||
      String(a.custom_url || "").localeCompare(String(b.custom_url || "")) ||
      String(a.name || "").localeCompare(String(b.name || "")) ||
      String(a.steam_id).localeCompare(String(b.steam_id))
  );
}

export function mergeSearchResults(rows: SearchResult[]): SearchResult[] {
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
        Boolean(existing.has_autochess_profile) ||
        Boolean(row.has_autochess_profile),
      has_games: Boolean(existing.has_games) || Boolean(row.has_games),
      drodo_profile_missing:
        Boolean(existing.drodo_profile_missing) &&
        Boolean(row.drodo_profile_missing),
    });
  }
  return [...merged.values()];
}

export async function markRowsWithGames(
  supabase: SupabaseClient,
  rows: SearchResult[]
): Promise<SearchResult[]> {
  const ids = [...new Set(rows.map((row) => row.steam_id))];
  if (ids.length === 0) return rows;

  const { data } = await supabase
    .from("match_players")
    .select("steam_id::text")
    .filter("steam_id", "in", `(${ids.join(",")})`)
    .limit(1000);

  const idsWithGames = new Set(
    ((data ?? []) as Array<{ steam_id: string }>).map((row) =>
      String(row.steam_id)
    )
  );

  return rows.map((row) => ({
    ...row,
    has_games: row.has_games || idsWithGames.has(row.steam_id),
  }));
}

export async function getDefaultPlayerSearchResults(
  supabase: SupabaseClient,
  limit = 5
): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from("users")
    .select(USER_SEARCH_SELECT)
    .order("drodo_last_fetched_at", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  const rows = ((data ?? []) as UserSearchRow[]).map(toSearchResult);
  return sortSearchResults(await markRowsWithGames(supabase, rows));
}
