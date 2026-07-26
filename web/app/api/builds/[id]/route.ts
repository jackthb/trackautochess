import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  asJson,
  jsonError,
  loadBuildRow,
  openBuildRoute,
  readJsonBody,
  type BuildRouteContext,
} from "@/lib/builds/route";
import {
  fetchUsersBySteamIds,
  toDetail,
  toSavedBuild,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import { isSavedBuildPayload } from "@/lib/builds/types";

const writeLimiter = new RateLimiterMemory({ points: 30, duration: 60 });

export async function GET(req: Request, context: BuildRouteContext) {
  const gate = await openBuildRoute(req, context, {
    path: "/api/builds/[id]",
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { id, service, steamIdNum: viewerSteamIdNum } = gate.ctx;

  const build = await loadBuildRow(service, id);
  if (!build.ok) return build.response;
  const row = build.ctx;

  const isOwner =
    viewerSteamIdNum != null && row.author_steam_id === viewerSteamIdNum;
  if (row.status !== "approved" && !isOwner) {
    return jsonError("Not found", 404);
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

export async function PATCH(req: Request, context: BuildRouteContext) {
  const gate = await openBuildRoute(req, context, {
    path: "/api/builds/[id]",
    limiter: writeLimiter,
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { id, service, steamIdNum } = gate.ctx;

  const build = await loadBuildRow(service, id);
  if (!build.ok) return build.response;
  const row = build.ctx;

  if (steamIdNum == null || row.author_steam_id !== steamIdNum) {
    return jsonError("Forbidden", 403);
  }
  if (row.status === "pending" || row.status === "approved") {
    return jsonError("Withdraw or copy the build before editing", 409);
  }

  const parsed = await readJsonBody<{ build?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  if (!isSavedBuildPayload(parsed.ctx.build)) {
    return jsonError("Invalid build payload", 400);
  }

  const name = parsed.ctx.build.name.trim().slice(0, 120) || "Untitled build";
  const description = parsed.ctx.build.description.trim().slice(0, 2000);
  const now = new Date().toISOString();
  const payload = {
    ...parsed.ctx.build,
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
    return jsonError(updateError?.message ?? "Update failed", 500);
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
