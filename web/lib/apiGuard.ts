/**
 * Shared preamble for the public API routes.
 *
 * Six routes opened with the same sequence — resolve the client IP/UA, run the
 * BotID check, then consume an IP rate-limit token, logging each denial — and
 * the copies had drifted: half built the header object with `toIncomingHeaders`
 * and half with `Object.fromEntries`, half passed a hand-rolled
 * `{ headers } as NextApiRequest` shim (no `socket`, so `getClientIp` silently
 * lost its fallback) instead of `toApiReq`, and the denial bodies used two
 * different shapes. Consolidating here keeps the abuse controls in one place: a
 * change to how routes identify or throttle a caller lands everywhere at once.
 *
 * Response bodies stay per-route configurable (`okFlag`, `rateLimitMessage`)
 * because existing clients already parse the current shapes.
 */
import type { NextApiRequest } from "next";
import type { IncomingHttpHeaders } from "node:http";
import { checkBotId } from "botid/server";
import type { RateLimiterMemory } from "rate-limiter-flexible";
import {
  getClientIp,
  getUserAgent,
  logAbuse,
  toApiReq,
  toIncomingHeaders,
} from "@/lib/abuseLog";

/** Either a denial to return as-is, or the resolved request context. */
export type ApiGate<T> =
  | { ok: false; response: Response }
  | { ok: true; ctx: T };

export interface ApiRequestContext {
  /** Node-shaped view of the request, for helpers that expect `NextApiRequest`. */
  apiReq: NextApiRequest;
  /** Plain header map, for `checkBotId` re-checks and cookie parsing. */
  headers: IncomingHttpHeaders;
  ip: string;
  ua: string;
}

export interface ApiGuardOptions {
  /** Route pattern recorded in abuse logs, e.g. "/api/drodo/[steamId]". */
  path: string;
  /** Omit for handlers that aren't rate limited. */
  limiter?: RateLimiterMemory;
  /** Emit `{ ok: false, error }` denial bodies instead of `{ error }`. */
  okFlag?: boolean;
  /** Override the 429 body message. */
  rateLimitMessage?: string;
}

function errorBody(message: string, okFlag: boolean | undefined) {
  return okFlag ? { ok: false, error: message } : { error: message };
}

/**
 * Runs the common guards in a fixed order: identify caller → BotID → rate
 * limit. Callers return `response` on denial and use `ctx` otherwise.
 */
export async function openApiRoute(
  req: Request,
  options: ApiGuardOptions,
): Promise<ApiGate<ApiRequestContext>> {
  const headers = toIncomingHeaders(req);
  const apiReq = toApiReq(req);
  const ip = getClientIp(apiReq);
  const ua = getUserAgent(apiReq);
  const { path } = options;

  const botCheck = await checkBotId({ advancedOptions: { headers } });
  if (botCheck.isBot && !botCheck.isVerifiedBot) {
    logAbuse("bot_blocked", { path, ip, ua });
    return {
      ok: false,
      response: Response.json(errorBody("Forbidden", options.okFlag), {
        status: 403,
      }),
    };
  }

  if (options.limiter) {
    try {
      await options.limiter.consume(ip);
    } catch {
      logAbuse("rate_limit_exceeded", { path, ip, ua });
      return {
        ok: false,
        response: Response.json(
          errorBody(
            options.rateLimitMessage ?? "Too many requests",
            options.okFlag,
          ),
          { status: 429 },
        ),
      };
    }
  }

  return { ok: true, ctx: { apiReq, headers, ip, ua } };
}
