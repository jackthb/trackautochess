import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  jsonError,
  loadBuildRow,
  openBuildRoute,
  readJsonBody,
  type BuildRouteContext,
} from "@/lib/builds/route";
import { fetchUsersBySteamIds, toComment } from "@/lib/builds/server";
import { COMMENT_MAX_LENGTH } from "@/lib/builds/types";

const writeLimiter = new RateLimiterMemory({ points: 20, duration: 60 });

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  author_steam_id: number;
}

export async function GET(req: Request, context: BuildRouteContext) {
  const gate = await openBuildRoute(req, context, {
    path: "/api/builds/[id]/comments",
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { id, service } = gate.ctx;

  const build = await loadBuildRow(service, id);
  if (!build.ok) return build.response;
  if (build.ctx.status !== "approved") {
    return jsonError("Not found", 404);
  }

  const { data, error } = await service
    .from("community_build_comments")
    .select("id, body, created_at, author_steam_id")
    .eq("build_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return jsonError(error.message, 500);
  }

  const rows = (data ?? []) as CommentRow[];
  const authors = await fetchUsersBySteamIds(
    service,
    rows.map((row) => row.author_steam_id),
  );

  return Response.json({
    comments: rows.map((row) => toComment(row, authors.get(row.author_steam_id))),
  });
}

export async function POST(req: Request, context: BuildRouteContext) {
  const gate = await openBuildRoute(req, context, {
    path: "/api/builds/[id]/comments",
    limiter: writeLimiter,
    requireSignIn: true,
    requireAdmin: true,
  });
  if (!gate.ok) return gate.response;
  const { id, service, steamIdNum } = gate.ctx;

  const build = await loadBuildRow(service, id);
  if (!build.ok) return build.response;
  if (build.ctx.status !== "approved") {
    return jsonError("Only approved builds accept comments", 409);
  }

  const parsed = await readJsonBody<{ body?: string }>(req);
  if (!parsed.ok) return parsed.response;

  const text = typeof parsed.ctx.body === "string" ? parsed.ctx.body.trim() : "";
  if (!text) {
    return jsonError("Comment cannot be empty", 400);
  }
  if (text.length > COMMENT_MAX_LENGTH) {
    return jsonError(`Comment must be at most ${COMMENT_MAX_LENGTH} characters`, 400);
  }

  const { data: inserted, error: insertError } = await service
    .from("community_build_comments")
    .insert({
      build_id: id,
      author_steam_id: steamIdNum,
      body: text,
    })
    .select("id, body, created_at, author_steam_id")
    .single();

  if (insertError || !inserted) {
    return jsonError(insertError?.message ?? "Comment failed", 500);
  }

  const authors = await fetchUsersBySteamIds(service, [steamIdNum]);
  return Response.json(
    { comment: toComment(inserted as CommentRow, authors.get(steamIdNum)) },
    { status: 201 },
  );
}
