import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
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

const rateLimiter = new RateLimiterMemory({ points: 60, duration: 60 });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SearchResult[] | { error: string }>
) {
  const botCheck = await checkBotId({ advancedOptions: { headers: req.headers } });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";
  try {
    await rateLimiter.consume(ip);
  } catch {
    return res.status(429).json({ error: "Too many requests" });
  }

  const rawQuery = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const query = rawQuery?.trim().replace(/[,()%*]/g, "") ?? "";
  const shouldSearchSteam = req.query.steam === "1";

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
    if (!supabase) return res.status(200).json([]);
    try {
      const rows = await getDefaultPlayerSearchResults(supabase);
      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
      );
      return res.status(200).json(rows);
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Search failed",
      });
    }
  }

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

    const nameMatches = await supabase
      .from("users")
      .select(USER_SEARCH_SELECT)
      .ilike("name", `%${query}%`)
      .limit(8);

    if (nameMatches.error) {
      return res.status(500).json({ error: nameMatches.error.message });
    }

    candidateRows.push(
      ...((nameMatches.data ?? []) as UserSearchRow[]).map(toSearchResult)
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
