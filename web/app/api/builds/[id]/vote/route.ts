import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  jsonError,
  loadBuildRow,
  openBuildRoute,
  type BuildRouteContext,
} from "@/lib/builds/route";

const writeLimiter = new RateLimiterMemory({ points: 40, duration: 60 });

export async function POST(req: Request, context: BuildRouteContext) {
  const gate = await openBuildRoute(req, context, {
    path: "/api/builds/[id]/vote",
    limiter: writeLimiter,
    requireSignIn: true,
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { id, service, steamIdNum } = gate.ctx;

  const build = await loadBuildRow(service, id);
  if (!build.ok) return build.response;
  const row = build.ctx;

  if (row.status !== "approved") {
    return jsonError("Only approved builds can be upvoted", 409);
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
      return jsonError(deleteError.message, 500);
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
    return jsonError(insertError.message, 500);
  }
  const nextCount = row.upvote_count + 1;
  await service
    .from("community_builds")
    .update({ upvote_count: nextCount })
    .eq("id", id);
  return Response.json({ upvoteCount: nextCount, viewerHasVoted: true });
}
