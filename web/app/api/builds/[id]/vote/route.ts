import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, logAbuse, toApiReq } from "@/lib/abuseLog";
import { parseSteamId, type CommunityBuildRow } from "@/lib/builds/server";
import { isUuid } from "@/lib/builds/types";
import { getSessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

const writeLimiter = new RateLimiterMemory({ points: 40, duration: 60 });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const path = "/api/builds/[id]/vote";
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);

  try {
    await writeLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip });
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const service = createSupabaseServiceRoleClient();
  if (!service) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(apiReq, anon);
  const steamIdNum = session.steamId ? parseSteamId(session.steamId) : null;
  if (steamIdNum == null) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data, error } = await service
    .from("community_builds")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const row = data as CommunityBuildRow;
  if (row.status !== "approved") {
    return Response.json({ error: "Only approved builds can be upvoted" }, { status: 409 });
  }

  const { data: existing } = await service
    .from("community_build_votes")
    .select("build_id")
    .eq("build_id", id)
    .eq("steam_id", steamIdNum)
    .maybeSingle();

  if (existing) {
    const { error: deleteError } = await service
      .from("community_build_votes")
      .delete()
      .eq("build_id", id)
      .eq("steam_id", steamIdNum);
    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 });
    }
    const nextCount = Math.max(0, row.upvote_count - 1);
    await service
      .from("community_builds")
      .update({ upvote_count: nextCount })
      .eq("id", id);
    return Response.json({ upvoteCount: nextCount, viewerHasVoted: false });
  }

  const { error: insertError } = await service.from("community_build_votes").insert({
    build_id: id,
    steam_id: steamIdNum,
  });
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }
  const nextCount = row.upvote_count + 1;
  await service
    .from("community_builds")
    .update({ upvote_count: nextCount })
    .eq("id", id);
  return Response.json({ upvoteCount: nextCount, viewerHasVoted: true });
}
