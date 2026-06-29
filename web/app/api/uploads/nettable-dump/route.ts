import { createSupabaseAnonClient } from "@/lib/supabase";
import {
  getR2NettableDumpConfig,
  putR2Object,
  r2ObjectPath,
} from "@/lib/r2ObjectStorage";
import { isSteamId64 } from "@dac/shared/steam";

export const runtime = "nodejs";

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const NETTABLE_DUMP_PATH_RE =
  /^(\d{17})\/nettable-dumps\/\d{8}_\d{6}_\d{6}\.json$/;

export async function POST(req: Request) {
  const config = getR2NettableDumpConfig();
  if (!config) {
    return Response.json({ error: "R2 is not configured" }, { status: 500 });
  }

  const steamId = await authenticatedSteamId(req);
  if (!steamId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const objectPath = req.headers.get("x-dac-object-path")?.trim() ?? "";
  const pathMatch = objectPath.match(NETTABLE_DUMP_PATH_RE);
  if (!pathMatch || !isSteamId64(pathMatch[1])) {
    return Response.json({ error: "Invalid object path" }, { status: 400 });
  }
  if (pathMatch[1] !== steamId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const maxBytes = maxUploadBytes();
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0) {
    return Response.json({ error: "Empty payload" }, { status: 400 });
  }
  if (body.length > maxBytes) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const payload = parseJsonObject(body);
  if (
    !payload ||
    payload.kind !== "nettable_dump_log" ||
    !Array.isArray(payload.rows)
  ) {
    return Response.json({ error: "Invalid nettable dump payload" }, { status: 400 });
  }

  try {
    await putR2Object(config, {
      key: objectPath,
      body,
      contentType: "application/json",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "R2 upload failed";
    return Response.json({ error: message }, { status: 502 });
  }

  return Response.json({
    ok: true,
    storage: "r2",
    path: r2ObjectPath(config, objectPath),
  });
}

async function authenticatedSteamId(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const supabase = createSupabaseAnonClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const steamId = steamIdFromSyntheticEmail(data.user.email ?? "");
  return steamId && isSteamId64(steamId) ? steamId : null;
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

function steamIdFromSyntheticEmail(email: string): string | null {
  return email.match(/^(\d+)@steam\.local$/i)?.[1] ?? null;
}

function parseJsonObject(body: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body.toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function maxUploadBytes(): number {
  const value = Number(process.env.R2_NETTABLE_DUMPS_MAX_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_BYTES;
}
