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
import type { CommunityBuildStatus, SavedBuild } from "@/lib/builds/types";

const writeLimiter = new RateLimiterMemory({ points: 40, duration: 60 });

export async function POST(req: Request, context: BuildRouteContext) {
  const gate = await openBuildRoute(req, context, {
    path: "/api/builds/[id]/review",
    limiter: writeLimiter,
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { id, service, steamIdNum: reviewerId } = gate.ctx;

  if (reviewerId == null) {
    return jsonError("Forbidden", 403);
  }

  const parsed = await readJsonBody<{ action?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.ctx;

  if (body.action !== "approve" && body.action !== "reject") {
    return jsonError("action must be approve or reject", 400);
  }

  const build = await loadBuildRow(service, id);
  if (!build.ok) return build.response;
  const row = build.ctx;

  if (row.status !== "pending") {
    return jsonError("Build is not pending review", 409);
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
    return jsonError(updateError?.message ?? "Review failed", 500);
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
