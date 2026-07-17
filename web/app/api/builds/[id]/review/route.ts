import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, logAbuse, toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/admin";
import {
  fetchUsersBySteamIds,
  parseSteamId,
  toDetail,
  toSavedBuild,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import {
  isUuid,
  type CommunityBuildStatus,
  type SavedBuild,
} from "@/lib/builds/types";
import type { Json } from "@/lib/database.generated.types";
import { getSessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

const writeLimiter = new RateLimiterMemory({ points: 40, duration: 60 });

type RouteContext = { params: Promise<{ id: string }> };

function asJson(value: SavedBuild): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function POST(req: Request, context: RouteContext) {
  const path = "/api/builds/[id]/review";
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
  if (!isAdminSteamId(session.steamId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const reviewerId = session.steamId ? parseSteamId(session.steamId) : null;
  if (reviewerId == null) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return Response.json({ error: "action must be approve or reject" }, { status: 400 });
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
  if (row.status !== "pending") {
    return Response.json({ error: "Build is not pending review" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const nextStatus: CommunityBuildStatus =
    body.action === "approve" ? "approved" : "rejected";
  const payload: SavedBuild = {
    ...toSavedBuild(row),
    status: nextStatus,
    updatedAt: now,
  };

  const { data: updated, error: updateError } = await service
    .from("community_builds")
    .update({
      status: nextStatus,
      reviewed_at: now,
      reviewed_by: reviewerId,
      updated_at: now,
      payload: asJson(payload),
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return Response.json(
      { error: updateError?.message ?? "Review failed" },
      { status: 500 },
    );
  }

  const next = updated as CommunityBuildRow;
  const authors = await fetchUsersBySteamIds(service, [next.author_steam_id]);
  return Response.json({
    build: {
      ...toDetail(next, authors.get(next.author_steam_id)),
      payload: toSavedBuild(next, payload),
    },
  });
}
