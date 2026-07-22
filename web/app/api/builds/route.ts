import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, logAbuse, toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/adminServer";
import {
  fetchUsersBySteamIds,
  parseSteamId,
  toDetail,
  toSavedBuild,
  toSummary,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import type { Json } from "@/lib/database.generated.types";
import {
  isSavedBuildPayload,
  isUuid,
  type SavedBuild,
} from "@/lib/builds/types";
import { getSessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

const writeLimiter = new RateLimiterMemory({ points: 30, duration: 60 });

async function requireService() {
  const service = createSupabaseServiceRoleClient();
  if (!service) {
    return { error: Response.json({ error: "Database not configured" }, { status: 500 }) };
  }
  return { service };
}

async function requireSession(req: Request) {
  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!session.steamId) {
    return { error: Response.json({ error: "Sign in required" }, { status: 401 }) };
  }
  const steamIdNum = parseSteamId(session.steamId);
  if (steamIdNum == null) {
    return { error: Response.json({ error: "Invalid session" }, { status: 401 }) };
  }
  return { steamId: session.steamId, steamIdNum };
}

function asJson(value: SavedBuild): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function sanitizePayload(build: SavedBuild): SavedBuild {
  return {
    id: build.id,
    name: build.name.trim().slice(0, 120) || "Untitled build",
    description: build.description.trim().slice(0, 2000),
    status: build.status,
    updatedAt: build.updatedAt || new Date().toISOString(),
    snapshots: Array.isArray(build.snapshots) ? build.snapshots : [],
  };
}

/** Admin-gated builds API. */
export async function GET(req: Request) {
  const { service, error } = await requireService();
  if (error || !service) return error!;

  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const status = url.searchParams.get("status");

  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!(await isAdminSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const viewerSteamIdNum = session.steamId ? parseSteamId(session.steamId) : null;

  if (mine) {
    if (!session.steamId || viewerSteamIdNum == null) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }
    const { data, error: queryError } = await service
      .from("community_builds")
      .select("*")
      .eq("author_steam_id", viewerSteamIdNum)
      .order("updated_at", { ascending: false });

    if (queryError) {
      return Response.json({ error: queryError.message }, { status: 500 });
    }

    const rows = (data ?? []) as CommunityBuildRow[];
    const authors = await fetchUsersBySteamIds(service, [viewerSteamIdNum]);
    return Response.json({
      builds: rows.map((row) => ({
        ...toSummary(row, authors.get(row.author_steam_id)),
        payload: toSavedBuild(row),
      })),
    });
  }

  if (status === "pending") {
    // Admin pending list is handled via review page + service checks there;
    // keep this public endpoint locked to approved unless caller is handled elsewhere.
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error: queryError } = await service
    .from("community_builds")
    .select("*")
    .eq("status", "approved")
    .order("upvote_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(100);

  if (queryError) {
    return Response.json({ error: queryError.message }, { status: 500 });
  }

  const rows = (data ?? []) as CommunityBuildRow[];
  const authors = await fetchUsersBySteamIds(
    service,
    rows.map((row) => row.author_steam_id),
  );

  let votedIds = new Set<string>();
  if (viewerSteamIdNum != null && rows.length > 0) {
    const { data: votes } = await service
      .from("community_build_votes")
      .select("build_id")
      .eq("steam_id", viewerSteamIdNum)
      .in(
        "build_id",
        rows.map((row) => row.id),
      );
    votedIds = new Set((votes ?? []).map((v: { build_id: string }) => v.build_id));
  }

  return Response.json({
    builds: rows.map((row) =>
      toSummary(row, authors.get(row.author_steam_id), votedIds.has(row.id)),
    ),
  });
}

export async function POST(req: Request) {
  const path = "/api/builds";
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);

  try {
    await writeLimiter.consume(ip);
  } catch {
    logAbuse("rate_limit_exceeded", { path, ip });
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const sessionResult = await requireSession(req);
  if ("error" in sessionResult) return sessionResult.error!;
  const { steamId, steamIdNum } = sessionResult;
  if (!(await isAdminSteamId(steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { service, error } = await requireService();
  if (error || !service) return error!;

  let body: { build?: unknown };
  try {
    body = (await req.json()) as { build?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isSavedBuildPayload(body.build)) {
    return Response.json({ error: "Invalid build payload" }, { status: 400 });
  }

  const sanitized = sanitizePayload(body.build);
  const now = new Date().toISOString();

  if (isUuid(sanitized.id)) {
    const { data: existing, error: existingError } = await service
      .from("community_builds")
      .select("*")
      .eq("id", sanitized.id)
      .maybeSingle();

    if (existingError) {
      return Response.json({ error: existingError.message }, { status: 500 });
    }

    if (existing) {
      const row = existing as CommunityBuildRow;
      if (row.author_steam_id !== steamIdNum) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      if (row.status === "pending" || row.status === "approved") {
        return Response.json(
          { error: "Withdraw or copy the build before editing" },
          { status: 409 },
        );
      }

      const { data: updated, error: updateError } = await service
        .from("community_builds")
        .update({
          name: sanitized.name,
          description: sanitized.description,
          payload: asJson({ ...sanitized, id: row.id, status: "draft" }),
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

      const authors = await fetchUsersBySteamIds(service, [steamIdNum]);
      const next = updated as CommunityBuildRow;
      return Response.json({
        build: {
          ...toDetail(next, authors.get(steamIdNum)),
          payload: toSavedBuild(next, sanitized),
        },
      });
    }
  }

  const { data: inserted, error: insertError } = await service
    .from("community_builds")
    .insert({
      author_steam_id: steamIdNum,
      name: sanitized.name,
      description: sanitized.description,
      payload: asJson(sanitized),
      status: "draft",
      updated_at: now,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    return Response.json(
      { error: insertError?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  const row = inserted as CommunityBuildRow;
  const authors = await fetchUsersBySteamIds(service, [steamIdNum]);
  const payload = toSavedBuild(row, sanitized);
  // Keep payload.id aligned with the DB uuid.
  await service
    .from("community_builds")
    .update({ payload: asJson({ ...payload, id: row.id, status: "draft" }) })
    .eq("id", row.id);

  return Response.json(
    {
      build: {
        ...toDetail(row, authors.get(steamIdNum)),
        payload: { ...payload, id: row.id, status: "draft" as const },
      },
    },
    { status: 201 },
  );
}
