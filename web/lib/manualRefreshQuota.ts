import { parse, serialize } from "cookie";

export interface ManualRefreshQuota {
  limit: number;
  used: number;
  remaining: number;
  reset_at: string;
}

const MANUAL_REFRESH_QUOTA_COOKIE = "dac_manual_refresh_quota";
export const MANUAL_REFRESH_DAILY_LIMIT = 5;

function quotaDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function resetAtForDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString();
}

function secondsUntilReset(resetAt: string, nowMs: number): number {
  return Math.max(1, Math.ceil((new Date(resetAt).getTime() - nowMs) / 1000));
}

function quotaFromUsed(used: number, day: string): ManualRefreshQuota {
  const safeUsed = Math.min(Math.max(0, used), MANUAL_REFRESH_DAILY_LIMIT);
  return {
    limit: MANUAL_REFRESH_DAILY_LIMIT,
    used: safeUsed,
    remaining: Math.max(0, MANUAL_REFRESH_DAILY_LIMIT - safeUsed),
    reset_at: resetAtForDay(day),
  };
}

function readUsedFromCookie(cookieHeader: string | undefined, day: string): number {
  const cookies = parse(cookieHeader ?? "");
  const raw = cookies[MANUAL_REFRESH_QUOTA_COOKIE];
  if (!raw) return 0;

  const [storedDay, storedUsed] = raw.split(".");
  if (storedDay !== day) return 0;

  const used = Number.parseInt(storedUsed, 10);
  return Number.isFinite(used) ? used : 0;
}

export function getManualRefreshQuota(
  cookieHeader: string | undefined,
  nowMs = Date.now()
): ManualRefreshQuota {
  const day = quotaDay(nowMs);
  return quotaFromUsed(readUsedFromCookie(cookieHeader, day), day);
}

export function consumeManualRefreshQuota(
  cookieHeader: string | undefined,
  nowMs = Date.now()
): { allowed: boolean; quota: ManualRefreshQuota; cookie: string } {
  const day = quotaDay(nowMs);
  const currentQuota = quotaFromUsed(readUsedFromCookie(cookieHeader, day), day);
  const quota =
    currentQuota.remaining > 0
      ? quotaFromUsed(currentQuota.used + 1, day)
      : currentQuota;

  return {
    allowed: currentQuota.remaining > 0,
    quota,
    cookie: serialize(
      MANUAL_REFRESH_QUOTA_COOKIE,
      `${day}.${quota.used}`,
      {
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: secondsUntilReset(quota.reset_at, nowMs),
      }
    ),
  };
}
