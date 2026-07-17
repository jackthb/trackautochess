import { RateLimiterMemory } from "rate-limiter-flexible";
import { getClientIp, logAbuse, toApiReq } from "@/lib/abuseLog";
import {
  fetchUsersBySteamIds,
  parseSteamId,
  toComment,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import { COMMENT_MAX_LENGTH, isUuid } from "@/lib/builds/types";
import { getSessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

const writeLimiter = new RateLimiterMemory({ points: 20, duration: 60 });

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const service = createSupabaseServiceRoleClient();
  if (!service) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const { data: build, error: buildError } = await service
    .from("community_builds")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (buildError) {
    return Response.json({ error: buildError.message }, { status: 500 });
  }
  if (!build || (build as CommunityBuildRow).status !== "approved") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await service
    .from("community_build_comments")
    .select("id, body, created_at, author_steam_id")
    .eq("build_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    body: string;
    created_at: string;
    author_steam_id: number;
  }>;
  const authors = await fetchUsersBySteamIds(
    service,
    rows.map((row) => row.author_steam_id),
  );

  return Response.json({
    comments: rows.map((row) => toComment(row, authors.get(row.author_steam_id))),
  });
}

export async function POST(req: Request, context: RouteContext) {
  const path = "/api/builds/[id]/comments";
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

  const { data: build, error: buildError } = await service
    .from("community_builds")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (buildError) {
    return Response.json({ error: buildError.message }, { status: 500 });
  }
  if (!build || (build as CommunityBuildRow).status !== "approved") {
    return Response.json({ error: "Only approved builds accept comments" }, { status: 409 });
  }

  let body: { body?: string };
  try {
    body = (await req.json()) as { body?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return Response.json({ error: "Comment cannot be empty" }, { status: 400 });
  }
  if (text.length > COMMENT_MAX_LENGTH) {
    return Response.json(
      { error: `Comment must be at most ${COMMENT_MAX_LENGTH} characters` },
      { status: 400 },
    );
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
    return Response.json(
      { error: insertError?.message ?? "Comment failed" },
      { status: 500 },
    );
  }

  const authors = await fetchUsersBySteamIds(service, [steamIdNum]);
  return Response.json(
    {
      comment: toComment(
        inserted as {
          id: string;
          body: string;
          created_at: string;
          author_steam_id: number;
        },
        authors.get(steamIdNum),
      ),
    },
    { status: 201 },
  );
}
