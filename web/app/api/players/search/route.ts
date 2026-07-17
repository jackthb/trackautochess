import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse, toApiReq, toIncomingHeaders } from "@/lib/abuseLog";
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  fetchSteamProfile,
  parseSteamInput,
  resolveSteamInput,
} from "@/lib/steam";
import {
  getDefaultPlayerSearchResults,
  markRowsWithGames,
  mergeSearchResults,
  sortSearchResults,
  toSearchResult,
  USER_SEARCH_SELECT,
  type SearchResult,
  type UserSearchRow,
} from "@/lib/playerSearch";
import { fetchAndCacheDrodo } from "@/lib/drodo";
import { DRODO_LIVE_FETCH_ENABLED } from "@/lib/drodoLive";
import { loadCachedDrodoRow } from "@/lib/drodoReadThrough";
import { revalidateQueenPages } from "@/lib/queensRevalidate";

const rateLimiter = new RateLimiterMemory({ points: 60, duration: 60 });

export async function GET(req: Request) {
  const path = "/api/players/search";
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);
  const ua = getUserAgent(apiReq);

  const botCheck = await checkBotId({
    advancedOptions: { headers: toIncomingHeaders(req) },
  });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    logAbuse("bot_blocked", { path, ip, ua });
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await rateLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip, ua });
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const searchParams = new URL(req.url).searchParams;
  const rawQuery = searchParams.get("q") ?? undefined;
  const query = rawQuery?.trim().replace(/[,()%*]/g, "") ?? "";
  const shouldSearchSteam = searchParams.get("steam") === "1";

  const supabase = createSupabaseServerClient() ?? undefined;

  if (!query) {
    if (!supabase) return Response.json([]);
    try {
      const rows = await getDefaultPlayerSearchResults(supabase);
      return Response.json(rows, {
        headers: {
          "Cache-Control":
            "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
        },
      });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Search failed",
        },
        { status: 500 }
      );
    }
  }

  const parsed = parseSteamInput(query);
  const profileQuery = parsed?.value ?? query;
  const vanityQuery = parsed?.kind === "slug" ? parsed.value : query;
  const steamIdQuery = parsed?.kind === "id"
    ? parsed.value
    : /^\d+$/.test(query)
      ? query
      : null;

  let rows: SearchResult[] = [];
  if (supabase) {
    const candidateRows: SearchResult[] = [];

    const exactCustom = await supabase
      .from("users")
      .select(USER_SEARCH_SELECT)
      .ilike("custom_url", vanityQuery)
      .limit(8);

    if (exactCustom.error) {
      return Response.json({ error: exactCustom.error.message }, { status: 500 });
    }

    candidateRows.push(
      ...((exactCustom.data ?? []) as UserSearchRow[]).map(toSearchResult)
    );

    if (steamIdQuery) {
      const exactSteamId = await supabase
        .from("users")
        .select(USER_SEARCH_SELECT)
        .filter("steam_id", "eq", steamIdQuery)
        .limit(1);

      if (exactSteamId.error) {
        return Response.json({ error: exactSteamId.error.message }, { status: 500 });
      }

      candidateRows.push(
        ...((exactSteamId.data ?? []) as UserSearchRow[]).map(toSearchResult)
      );
    }

    const prefixCustom = await supabase
      .from("users")
      .select(USER_SEARCH_SELECT)
      .ilike("custom_url", `${vanityQuery}%`)
      .limit(8);

    if (prefixCustom.error) {
      return Response.json({ error: prefixCustom.error.message }, { status: 500 });
    }

    candidateRows.push(
      ...((prefixCustom.data ?? []) as UserSearchRow[]).map(toSearchResult)
    );

    // Search resolves only by Steam ID or vanity URL — never by display name.
    // (The display name is still shown in results for recognition.)

    rows = sortSearchResults(
      await markRowsWithGames(supabase, mergeSearchResults(candidateRows)),
      profileQuery
    );
  }

  let authoritativeSteamId: string | null = null;
  if (parsed && shouldSearchSteam) {
    const resolvedSteamId = await resolveSteamInput(query, supabase, {
      persist: true,
    });
    authoritativeSteamId = resolvedSteamId;
    if (resolvedSteamId) {
      const profile = await fetchSteamProfile(resolvedSteamId, supabase, {
        persist: true,
        requireAvatar: true,
        requireCustomUrl: parsed.kind === "id",
      });

      // Only a real result if the profile has Auto Chess data — a Drodo
      // profile or tracked games. Otherwise the client errors instead of
      // opening an empty profile.
      const [drodoResult, gamesCheck] = await Promise.all([
        DRODO_LIVE_FETCH_ENABLED
          ? fetchAndCacheDrodo(resolvedSteamId, supabase ?? null, {
              snapshotOnSuccess: true,
              pollMode: "reset",
              onQueenChange: revalidateQueenPages,
            })
          : supabase
            ? loadCachedDrodoRow(supabase, resolvedSteamId).then((row) =>
                row && !row.drodo_profile_missing
                  ? ({ ok: true as const, profile: row })
                  : ({
                      ok: false as const,
                      kind: "missing" as const,
                      error: "cached",
                    })
              )
            : Promise.resolve({
                ok: false as const,
                kind: "missing" as const,
                error: "cached",
              }),
        supabase
          ? supabase
              .from("match_players")
              .select("steam_id::text")
              .filter("steam_id", "eq", resolvedSteamId)
              .limit(1)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);
      const hasAutochess = drodoResult.ok;
      const hasGames = ((gamesCheck.data as unknown[] | null) ?? []).length > 0;

      rows = mergeSearchResults([
        {
          steam_id: resolvedSteamId,
          name: profile.name,
          custom_url:
            profile.customUrl ?? (parsed.kind === "slug" ? parsed.value : null),
          has_autochess_profile: hasAutochess,
          has_games: hasGames,
          drodo_profile_missing: !hasAutochess,
        },
        ...rows,
      ]);
    }
  }

  rows = sortSearchResults(mergeSearchResults(rows), profileQuery);
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

  return Response.json(rows);
}
