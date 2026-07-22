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
import { isSavedBuildPayload, isUuid } from "@/lib/builds/types";
import type { Json } from "@/lib/database.generated.types";
import { getSessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

const writeLimiter = new RateLimiterMemory({ points: 30, duration: 60 });

type RouteContext = { params: Promise<{ id: string }> };

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

async function loadBuild(id: string) {
  if (!isUuid(id)) return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  const service = createSupabaseServiceRoleClient();
  if (!service) {
    return { error: Response.json({ error: "Database not configured" }, { status: 500 }) };
  }
  const { data, error } = await service
    .from("community_builds")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { error: Response.json({ error: error.message }, { status: 500 }) };
  }
  if (!data) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  }
  return { service, row: data as CommunityBuildRow };
}

export async function GET(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadBuild(id);
  if ("error" in loaded) return loaded.error!;
  const { service, row } = loaded;

  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!(await isAdminSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const viewerSteamIdNum = session.steamId ? parseSteamId(session.steamId) : null;
  const isOwner =
    viewerSteamIdNum != null && row.author_steam_id === viewerSteamIdNum;

  if (row.status !== "approved" && !isOwner) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const authors = await fetchUsersBySteamIds(service, [row.author_steam_id]);
  let viewerHasVoted = false;
  if (viewerSteamIdNum != null && row.status === "approved") {
    const { data: vote } = await service
      .from("community_build_votes")
      .select("build_id")
      .eq("build_id", row.id)
      .eq("steam_id", viewerSteamIdNum)
      .maybeSingle();
    viewerHasVoted = Boolean(vote);
  }

  return Response.json({
    build: {
      ...toDetail(row, authors.get(row.author_steam_id), viewerHasVoted),
      payload: toSavedBuild(row),
    },
  });
}

export async function PATCH(req: Request, context: RouteContext) {
  const path = "/api/builds/[id]";
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);

  try {
    await writeLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip });
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await context.params;
  const loaded = await loadBuild(id);
  if ("error" in loaded) return loaded.error!;
  const { service, row } = loaded;

  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(apiReq, anon);
  const steamIdNum = session.steamId ? parseSteamId(session.steamId) : null;
  if (steamIdNum == null || row.author_steam_id !== steamIdNum) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await isAdminSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (row.status === "pending" || row.status === "approved") {
    return Response.json(
      { error: "Withdraw or copy the build before editing" },
      { status: 409 },
    );
  }

  let body: { build?: unknown };
  try {
    body = (await req.json()) as { build?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isSavedBuildPayload(body.build)) {
    return Response.json({ error: "Invalid build payload" }, { status: 400 });
  }

  const name = body.build.name.trim().slice(0, 120) || "Untitled build";
  const description = body.build.description.trim().slice(0, 2000);
  const now = new Date().toISOString();
  const payload = {
    ...body.build,
    id: row.id,
    name,
    description,
    status: "draft" as const,
    updatedAt: now,
  };

  const { data: updated, error: updateError } = await service
    .from("community_builds")
    .update({
      name,
      description,
      payload: asJson(payload),
      status: "draft",
      updated_at: now,
      reviewed_at: null,
      reviewed_by: null,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return Response.json(
      { error: updateError?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  const next = updated as CommunityBuildRow;
  const authors = await fetchUsersBySteamIds(service, [steamIdNum]);
  return Response.json({
    build: {
      ...toDetail(next, authors.get(steamIdNum)),
      payload: toSavedBuild(next, payload),
    },
  });
}
