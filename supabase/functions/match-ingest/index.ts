import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.4";
import {
  bindTimelineToStoredMatch,
  steamId,
  validateMatchRequest,
  validatePlayerUpdateRequest,
  validateTimelineRequest,
  ValidationError,
} from "../_shared/match-ingest-validation.ts";

const MAX_REQUEST_BYTES = 5_000_000;

type AdminClient = SupabaseClient<any, "public", any>;
class PayloadTooLargeError extends Error {}

function response(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function databaseErrorResponse(error: unknown): Response | null {
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error as { message?: unknown } | null)?.message;
  if (code === "42501") return response(403, { error: "ownership_rejected" });
  if (code === "23514") return response(409, { error: "roster_conflict" });
  if (
    code === "P0001" && typeof message === "string" &&
    message.includes("rate limit")
  ) {
    return response(429, { error: "rate_limit_exceeded" });
  }
  return null;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice(7).trim() || null;
}

function callerSteamId(
  user: { app_metadata?: Record<string, unknown> },
): string {
  return steamId(
    user.app_metadata?.steam_id,
    "authenticated app_metadata.steam_id",
  );
}

async function readLimitedBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body;
}

async function ingestMatch(
  admin: AdminClient,
  payload: unknown,
  caller: string,
): Promise<Response> {
  const validated = validateMatchRequest(payload, caller);
  const { data, error } = await admin.rpc("ingest_match_capture", {
    p_match: validated.match,
    p_players: validated.players,
    p_caller_steam_id: caller,
  });
  if (error) throw error;
  return response(200, { match_id: data });
}

async function upsertTimeline(
  admin: AdminClient,
  payload: unknown,
  caller: string,
): Promise<Response> {
  const validated = validateTimelineRequest(payload, caller);
  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("observer_steam_id::text,played_at")
    .eq("match_id", validated.matchId)
    .maybeSingle();
  if (matchError) throw matchError;
  if (!match || String(match.observer_steam_id) !== caller) {
    return response(403, { error: "match_not_owned" });
  }

  const { data: playerRows, error: playersError } = await admin
    .from("match_players")
    .select("steam_id::text")
    .eq("match_id", validated.matchId);
  if (playersError) throw playersError;
  const roster = (playerRows ?? []).map((row) => String(row.steam_id)).sort();
  bindTimelineToStoredMatch(validated, roster, String(match.played_at), caller);

  const { data, error } = await admin.rpc("ingest_match_timeline", {
    p_timeline: validated.row.timeline,
    p_caller_steam_id: caller,
    p_roster: roster,
  });
  if (error) throw error;
  return response(200, { match_id: validated.matchId, updated: data });
}

async function updateMatchPlayer(
  admin: AdminClient,
  payload: unknown,
  caller: string,
): Promise<Response> {
  const validated = validatePlayerUpdateRequest(payload);
  const { data: player, error: playerError } = await admin
    .from("match_players")
    .select("steam_id::text")
    .eq("id", validated.id)
    .maybeSingle();
  if (playerError) throw playerError;
  if (!player || String(player.steam_id) !== caller) {
    return response(403, { error: "match_player_not_owned" });
  }
  const { error: updateError } = await admin
    .from("match_players")
    .update(validated.fields)
    .eq("id", validated.id)
    .eq("steam_id", caller);
  if (updateError) throw updateError;
  return response(200, { id: validated.id });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return response(405, { error: "method_not_allowed" });
  }
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength == null ? 0 : Number(contentLength);
  if (
    !Number.isFinite(declaredLength) || declaredLength < 0 ||
    declaredLength > MAX_REQUEST_BYTES
  ) {
    return response(413, { error: "payload_too_large" });
  }
  const token = bearerToken(request);
  if (!token) {
    return response(401, { error: "missing_bearer_token" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("match-ingest is missing Supabase service configuration");
    return response(500, { error: "server_not_configured" });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return response(401, { error: "invalid_session" });
  }

  try {
    const caller = callerSteamId(authData.user);
    const rawBody = await readLimitedBody(request);
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return response(400, { error: "invalid_json" });
    }
    const action = (payload as { action?: unknown } | null)?.action;
    if (action === "ingest_match") {
      return await ingestMatch(admin, payload, caller);
    }
    if (action === "upsert_timeline") {
      return await upsertTimeline(admin, payload, caller);
    }
    if (action === "update_match_player") {
      return await updateMatchPlayer(admin, payload, caller);
    }
    return response(400, { error: "unsupported_action" });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return response(413, { error: "payload_too_large" });
    }
    if (error instanceof ValidationError) {
      return response(422, { error: "invalid_payload", detail: error.message });
    }
    const databaseResponse = databaseErrorResponse(error);
    if (databaseResponse) return databaseResponse;
    console.error("match-ingest failed", error);
    return response(500, { error: "ingest_failed" });
  }
});
