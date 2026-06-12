import type { NextApiRequest } from "next";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Structured abuse-signal logging. Emits a single JSON line per event so
 * Vercel's log drain (e.g. Axiom, BetterStack) can index and alert on it.
 * Query examples:
 *   event=="rate_limit_exceeded" | summarize count() by ip, path
 *   event=="bot_blocked" and path startswith "/api/drodo"
 */

export type AbuseEvent =
  | "rate_limit_exceeded"
  | "bot_blocked"
  | "manual_refresh_quota_exceeded";

interface AbuseFields {
  path: string;
  ip: string;
  ua?: string;
  steam_id?: string | null;
  [key: string]: unknown;
}

export function logAbuse(event: AbuseEvent, fields: AbuseFields): void {
  const payload = {
    type: "abuse",
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  console.warn(JSON.stringify(payload));
}

export function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : undefined;
  return first || req.socket?.remoteAddress || "unknown";
}

export function getUserAgent(req: NextApiRequest): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 240) : "";
}

export function toIncomingHeaders(req: Request): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

export function toApiReq(req: Request): NextApiRequest {
  return {
    headers: toIncomingHeaders(req),
    socket: { remoteAddress: undefined },
  } as unknown as NextApiRequest;
}
