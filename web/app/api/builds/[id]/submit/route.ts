import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  asJson,
  jsonError,
  loadBuildRow,
  openBuildRoute,
  type BuildRouteContext,
} from "@/lib/builds/route";
import {
  fetchUsersBySteamIds,
  toDetail,
  toSavedBuild,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import type { SavedBuild } from "@/lib/builds/types";

const writeLimiter = new RateLimiterMemory({ points: 20, duration: 60 });

export async function POST(req: Request, context: BuildRouteContext) {
  const gate = await openBuildRoute(req, context, {
    path: "/api/builds/[id]/submit",
    limiter: writeLimiter,
    requireSignIn: true,
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { id, service, steamIdNum } = gate.ctx;

  const build = await loadBuildRow(service, id);
  if (!build.ok) return build.response;
  const row = build.ctx;

  if (row.author_steam_id !== steamIdNum) {
    return jsonError("Forbidden", 403);
  }
  if (row.status !== "draft" && row.status !== "rejected") {
    return jsonError("Only draft or rejected builds can be submitted", 409);
  }
  if (!row.name.trim() || row.name.trim() === "Untitled build") {
    return jsonError("Name your build before submitting", 400);
  }

  const payload = toSavedBuild(row);
  if (!payload.snapshots.some((snap) => snap.pieces.length > 0)) {
    return jsonError("Add at least one piece before submitting", 400);
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
    return jsonError(updateError?.message ?? "Submit failed", 500);
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
