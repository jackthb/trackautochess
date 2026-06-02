import { parse, serialize } from "cookie";

export interface ManualRefreshQuota {
  limit: number;
  used: number;
  remaining: number;
  reset_at: string;
}

const MANUAL_REFRESH_QUOTA_COOKIE = "dac_manual_refresh_quota";
const MANUAL_REFRESH_COOLDOWN_SECONDS = 60 * 60;
const MANUAL_REFRESH_COOLDOWN_MS = MANUAL_REFRESH_COOLDOWN_SECONDS * 1000;
export const MANUAL_REFRESH_HOURLY_LIMIT = 1;

function resetAtFromNow(nowMs: number): string {
  return new Date(nowMs + MANUAL_REFRESH_COOLDOWN_MS).toISOString();
}

function resetAtFromUnixMs(resetAtMs: number): string {
  return new Date(resetAtMs).toISOString();
}

function secondsUntilReset(resetAt: string, nowMs: number): number {
  return Math.max(1, Math.ceil((new Date(resetAt).getTime() - nowMs) / 1000));
}

function availableQuota(nowMs: number): ManualRefreshQuota {
  return {
    limit: MANUAL_REFRESH_HOURLY_LIMIT,
    used: 0,
    remaining: MANUAL_REFRESH_HOURLY_LIMIT,
    reset_at: resetAtFromNow(nowMs),
  };
}

function consumedQuota(resetAtMs: number): ManualRefreshQuota {
  return {
    limit: MANUAL_REFRESH_HOURLY_LIMIT,
    used: MANUAL_REFRESH_HOURLY_LIMIT,
    remaining: 0,
    reset_at: resetAtFromUnixMs(resetAtMs),
  };
}

function readResetAtMsFromCookie(
  cookieHeader: string | undefined,
  nowMs: number
): number | null {
  const cookies = parse(cookieHeader ?? "");
  const raw = cookies[MANUAL_REFRESH_QUOTA_COOKIE];
  if (!raw) return null;

  const resetAtMs = Number.parseInt(raw, 10);
  if (!Number.isFinite(resetAtMs) || resetAtMs <= nowMs) return null;

  return resetAtMs;
}

export function getManualRefreshQuota(
  cookieHeader: string | undefined,
  nowMs = Date.now()
): ManualRefreshQuota {
  const resetAtMs = readResetAtMsFromCookie(cookieHeader, nowMs);
  return resetAtMs ? consumedQuota(resetAtMs) : availableQuota(nowMs);
}

export function consumeManualRefreshQuota(
  cookieHeader: string | undefined,
  nowMs = Date.now()
): { allowed: boolean; quota: ManualRefreshQuota; cookie: string } {
  const resetAtMs = readResetAtMsFromCookie(cookieHeader, nowMs);
  const allowed = resetAtMs === null;
  const quotaResetAtMs = allowed ? nowMs + MANUAL_REFRESH_COOLDOWN_MS : resetAtMs;
  const quota = consumedQuota(quotaResetAtMs);

  return {
    allowed,
    quota,
    cookie: serialize(
      MANUAL_REFRESH_QUOTA_COOKIE,
      String(quotaResetAtMs),
      {
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: allowed
          ? MANUAL_REFRESH_COOLDOWN_SECONDS
          : secondsUntilReset(quota.reset_at, nowMs),
      }
    ),
  };
}
