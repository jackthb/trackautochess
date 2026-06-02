import type { NextApiRequest } from "next";
import { createClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, getUserAgent, logAbuse } from "@/lib/abuseLog";
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

// Adapt a Web Request into the minimal NextApiRequest shape consumed by the
// abuseLog helpers (getClientIp reads req.headers["x-forwarded-for"] and
// req.socket.remoteAddress; getUserAgent reads req.headers["user-agent"]).
function toApiReq(req: Request): NextApiRequest {
  return {
    headers: {
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? undefined,
      "user-agent": req.headers.get("user-agent") ?? undefined,
    },
    socket: { remoteAddress: undefined },
  } as unknown as NextApiRequest;
}

const rateLimiter = new RateLimiterMemory({ points: 60, duration: 60 });

export async function GET(req: Request) {
  const path = "/api/players/search";
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);
  const ua = getUserAgent(apiReq);

  const botCheck = await checkBotId({
    advancedOptions: { headers: Object.fromEntries(req.headers) },
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
        .eq("steam_id", steamIdQuery)
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

    const nameMatches = await supabase
      .from("users")
      .select(USER_SEARCH_SELECT)
      .ilike("name", `%${profileQuery}%`)
      .limit(8);

    if (nameMatches.error) {
      return Response.json({ error: nameMatches.error.message }, { status: 500 });
    }

    candidateRows.push(
      ...((nameMatches.data ?? []) as UserSearchRow[]).map(toSearchResult)
    );

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
      rows = mergeSearchResults([
        {
          steam_id: resolvedSteamId,
          name: profile.name,
          custom_url:
            profile.customUrl ?? (parsed.kind === "slug" ? parsed.value : null),
          has_autochess_profile: false,
          drodo_profile_missing: false,
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
