import { createHmac, timingSafeEqual } from "crypto";

const ALLOWED_TWITCH_EXTENSION_ROLES = [
  "broadcaster",
  "moderator",
  "viewer",
] as const;

type TwitchExtensionRole = (typeof ALLOWED_TWITCH_EXTENSION_ROLES)[number];

export interface TwitchExtensionJwtPayload {
  channel_id: string;
  exp: number;
  opaque_user_id?: string;
  role: TwitchExtensionRole;
  user_id?: string;
}

function base64UrlToBuffer(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function parseJsonPart(value: string): unknown {
  return JSON.parse(base64UrlToBuffer(value).toString("utf8")) as unknown;
}

function getExtensionSecrets(): Buffer[] {
  const raw =
    process.env.TWITCH_EXTENSION_SHARED_SECRETS ||
    process.env.TWITCH_EXTENSION_SHARED_SECRET ||
    "";

  return raw
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean)
    .map((secret) => Buffer.from(secret, "base64"))
    .filter((secret) => secret.length > 0);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-extension-jwt")?.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTwitchExtensionRole(value: unknown): value is TwitchExtensionRole {
  return (
    typeof value === "string" &&
    ALLOWED_TWITCH_EXTENSION_ROLES.includes(value as TwitchExtensionRole)
  );
}

function parsePayload(value: unknown): TwitchExtensionJwtPayload | null {
  if (!isRecord(value)) return null;

  const role = value.role;
  if (!isTwitchExtensionRole(role)) {
    return null;
  }

  if (typeof value.channel_id !== "string" || !value.channel_id) {
    return null;
  }

  if (typeof value.exp !== "number" || !Number.isFinite(value.exp)) {
    return null;
  }

  return {
    channel_id: value.channel_id,
    exp: value.exp,
    opaque_user_id:
      typeof value.opaque_user_id === "string" ? value.opaque_user_id : undefined,
    role,
    user_id: typeof value.user_id === "string" ? value.user_id : undefined,
  };
}

export function verifyTwitchExtensionRequest(
  request: Request
): TwitchExtensionJwtPayload | null {
  const secrets = getExtensionSecrets();
  if (secrets.length === 0) {
    throw new Error("TWITCH_EXTENSION_SHARED_SECRET is not configured");
  }

  const token = getBearerToken(request);
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: unknown;
  let payload: TwitchExtensionJwtPayload | null;
  try {
    header = parseJsonPart(encodedHeader);
    payload = parsePayload(parseJsonPart(encodedPayload));
  } catch {
    return null;
  }

  if (!isRecord(header) || header.alg !== "HS256") return null;
  if (!payload) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

  const signedContent = `${encodedHeader}.${encodedPayload}`;
  const actualSignature = base64UrlToBuffer(encodedSignature);

  return secrets.some((secret) => {
    const expectedSignature = createHmac("sha256", secret)
      .update(signedContent)
      .digest();
    return (
      actualSignature.length === expectedSignature.length &&
      timingSafeEqual(actualSignature, expectedSignature)
    );
  })
    ? payload
    : null;
}
