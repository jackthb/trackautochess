import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, logAbuse, toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/adminServer";
import {
  fetchUsersBySteamIds,
  parseSteamId,
  toDetail,
  toSavedBuild,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import { isUuid, type SavedBuild } from "@/lib/builds/types";
import type { Json } from "@/lib/database.generated.types";
import { getSessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

const writeLimiter = new RateLimiterMemory({ points: 20, duration: 60 });

type RouteContext = { params: Promise<{ id: string }> };

function asJson(value: SavedBuild): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function POST(req: Request, context: RouteContext) {
  const path = "/api/builds/[id]/submit";
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
  if (!(await isAdminSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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
  if (row.author_steam_id !== steamIdNum) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (row.status !== "draft" && row.status !== "rejected") {
    return Response.json(
      { error: "Only draft or rejected builds can be submitted" },
      { status: 409 },
    );
  }
  if (!row.name.trim() || row.name.trim() === "Untitled build") {
    return Response.json({ error: "Name your build before submitting" }, { status: 400 });
  }

  const payload = toSavedBuild(row);
  if (!payload.snapshots.some((snap) => snap.pieces.length > 0)) {
    return Response.json(
      { error: "Add at least one piece before submitting" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const nextPayload: SavedBuild = {
    ...payload,
    status: "pending",
    updatedAt: now,
  };

  const { data: updated, error: updateError } = await service
    .from("community_builds")
    .update({
      status: "pending",
      submitted_at: now,
      updated_at: now,
      reviewed_at: null,
      reviewed_by: null,
      payload: asJson(nextPayload),
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return Response.json(
      { error: updateError?.message ?? "Submit failed" },
      { status: 500 },
    );
  }

  const next = updated as CommunityBuildRow;
  const authors = await fetchUsersBySteamIds(service, [steamIdNum]);
  return Response.json({
    build: {
      ...toDetail(next, authors.get(steamIdNum)),
      payload: toSavedBuild(next, nextPayload),
    },
  });
}
