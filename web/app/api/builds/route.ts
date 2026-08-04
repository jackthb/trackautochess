import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  asJson,
  jsonError,
  openBuildsRoute,
  readJsonBody,
} from "@/lib/builds/route";
import {
  fetchUsersBySteamIds,
  toDetail,
  toSavedBuild,
  toSummary,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import {
  isSavedBuildPayload,
  isUuid,
  type SavedBuild,
} from "@/lib/builds/types";

const writeLimiter = new RateLimiterMemory({ points: 30, duration: 60 });

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
  const gate = await openBuildsRoute(req, {
    path: "/api/builds",
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { service, steamIdNum: viewerSteamIdNum } = gate.ctx;

  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const status = url.searchParams.get("status");

  if (mine) {
    if (viewerSteamIdNum == null) {
      return jsonError("Sign in required", 401);
    }
    const { data, error: queryError } = await service
      .from("community_builds")
      .select("*")
      .eq("author_steam_id", viewerSteamIdNum)
      .order("updated_at", { ascending: false });

    if (queryError) {
      return jsonError(queryError.message, 500);
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
    return jsonError("Forbidden", 403);
  }

  const { data, error: queryError } = await service
    .from("community_builds")
    .select("*")
    .eq("status", "approved")
    .order("upvote_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(100);

  if (queryError) {
    return jsonError(queryError.message, 500);
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
  const gate = await openBuildsRoute(req, {
    path: "/api/builds",
    limiter: writeLimiter,
    requireSignIn: true,
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { service, steamIdNum } = gate.ctx;

  const parsed = await readJsonBody<{ build?: unknown }>(req);
  if (!parsed.ok) return parsed.response;

  const build = parsed.ctx.build;
  if (!isSavedBuildPayload(build)) {
    return jsonError("Invalid build payload", 400);
  }

  const sanitized = sanitizePayload(build);
  const now = new Date().toISOString();

  if (isUuid(sanitized.id)) {
    const { data: existing, error: existingError } = await service
      .from("community_builds")
      .select("*")
      .eq("id", sanitized.id)
      .maybeSingle();

    if (existingError) {
      return jsonError(existingError.message, 500);
    }

    if (existing) {
      const row = existing as CommunityBuildRow;
      if (row.author_steam_id !== steamIdNum) {
        return jsonError("Forbidden", 403);
      }
      if (row.status === "pending" || row.status === "approved") {
        return jsonError("Withdraw or copy the build before editing", 409);
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
        return jsonError(updateError?.message ?? "Update failed", 500);
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
    return jsonError(insertError?.message ?? "Insert failed", 500);
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
