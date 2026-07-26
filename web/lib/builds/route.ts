/**
 * Shared preamble for the /api/builds route handlers.
 *
 * Every builds route repeated the same opening sequence — rate limit, validate
 * the `[id]` param, get a service-role client, resolve the session, then check
 * sign-in / admin — and the copies had already started to drift in ordering.
 * Consolidating it here keeps the auth sequence in one place: a change to how
 * builds authorize lands in every route at once instead of five near-copies.
 */
import type { NextApiRequest } from "next";
import type { RateLimiterMemory } from "rate-limiter-flexible";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIp, logAbuse, toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/adminServer";
import { parseSteamId, type CommunityBuildRow } from "@/lib/builds/server";
import { isUuid } from "@/lib/builds/types";
import type { Database, Json } from "@/lib/database.generated.types";
import { getSessionUser, type SessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

export type BuildsSupabaseClient = SupabaseClient<Database>;

export type BuildRouteContext = { params: Promise<{ id: string }> };

/** Either a denial to return as-is, or the resolved request context. */
export type Gate<T> =
  | { ok: false; response: Response }
  | { ok: true; ctx: T };

export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** Round-trips a value through JSON so it satisfies Supabase's `Json` column type. */
export function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export interface BuildRouteOptions {
  /** Route pattern recorded in abuse logs, e.g. "/api/builds/[id]/vote". */
  path: string;
  /** Omit for read-only handlers that aren't rate limited. */
  limiter?: RateLimiterMemory;
  /** Reject with 401 when the session has no usable steam id. */
  requireSignIn?: boolean;
  /** Reject with 403 when the session steam id is not an admin. */
  requireAdmin?: boolean;
}

export interface BuildRequest {
  apiReq: NextApiRequest;
  ip: string;
  /** The `[id]` route param, already validated as a UUID. */
  id: string;
  service: BuildsSupabaseClient;
  session: SessionUser;
  /**
   * The session steam id as the numeric form stored in Postgres, or null when
   * signed out. Non-null whenever `requireSignIn` was set.
   */
  steamIdNum: number | null;
}

/** `BuildRequest` once `requireSignIn` has ruled out the signed-out case. */
export type SignedInBuildRequest = BuildRequest & { steamIdNum: number };

/**
 * Runs the common guards in a fixed order: rate limit → id → service client →
 * session → sign-in → admin. Callers return `response` on denial and use `ctx`
 * otherwise.
 */
export async function openBuildRoute(
  req: Request,
  context: BuildRouteContext,
  options: BuildRouteOptions & { requireSignIn: true },
): Promise<Gate<SignedInBuildRequest>>;
export async function openBuildRoute(
  req: Request,
  context: BuildRouteContext,
  options: BuildRouteOptions,
): Promise<Gate<BuildRequest>>;
export async function openBuildRoute(
  req: Request,
  context: BuildRouteContext,
  options: BuildRouteOptions,
): Promise<Gate<BuildRequest>> {
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);

  if (options.limiter) {
    try {
      await options.limiter.consume(ip);
    } catch {
      logAbuse("rate_limit_exceeded", { path: options.path, ip });
      return { ok: false, response: jsonError("Too many requests", 429) };
    }
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return { ok: false, response: jsonError("Not found", 404) };
  }

  const service = createSupabaseServiceRoleClient();
  if (!service) {
    return { ok: false, response: jsonError("Database not configured", 500) };
  }

  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(apiReq, anon);
  const steamIdNum = session.steamId ? parseSteamId(session.steamId) : null;

  if (options.requireSignIn && steamIdNum == null) {
    return { ok: false, response: jsonError("Sign in required", 401) };
  }
  if (options.requireAdmin && !(await isAdminSteamId(session.steamId))) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return { ok: true, ctx: { apiReq, ip, id, service, session, steamIdNum } };
}

/** Fetches one build row, mapping a query error to 500 and a miss to 404. */
export async function loadBuildRow(
  service: BuildsSupabaseClient,
  id: string,
): Promise<Gate<CommunityBuildRow>> {
  const { data, error } = await service
    .from("community_builds")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { ok: false, response: jsonError(error.message, 500) };
  }
  if (!data) {
    return { ok: false, response: jsonError("Not found", 404) };
  }
  return { ok: true, ctx: data as CommunityBuildRow };
}

/** Parses a JSON request body, mapping malformed input to 400. */
export async function readJsonBody<T>(req: Request): Promise<Gate<T>> {
  try {
    return { ok: true, ctx: (await req.json()) as T };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body", 400) };
  }
}
