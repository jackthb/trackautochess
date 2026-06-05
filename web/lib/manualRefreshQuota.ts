import { parse, serialize } from "cookie";

export interface ManualRefreshQuota {
  limit: number;
  used: number;
  remaining: number;
  reset_at: string;
}

export type ManualRefreshCadence = "owner" | "public";

export interface ManualRefreshQuotaOptions {
  cadence?: ManualRefreshCadence;
  target?: string | null;
}

const OWNER_REFRESH_QUOTA_COOKIE = "dac_manual_refresh_quota";
const PUBLIC_REFRESH_QUOTA_COOKIE = "dac_public_refresh_quota";
const OWNER_REFRESH_COOLDOWN_SECONDS = 30 * 60;
const PUBLIC_REFRESH_COOLDOWN_SECONDS = 24 * 60 * 60;
const PUBLIC_REFRESH_COOKIE_ENTRY_LIMIT = 50;
export const MANUAL_REFRESH_LIMIT = 1;

function cooldownSeconds(cadence: ManualRefreshCadence): number {
  return cadence === "owner"
    ? OWNER_REFRESH_COOLDOWN_SECONDS
    : PUBLIC_REFRESH_COOLDOWN_SECONDS;
}

function resetAtFromNow(nowMs: number, cooldownMs: number): string {
  return new Date(nowMs + cooldownMs).toISOString();
}

function resetAtFromUnixMs(resetAtMs: number): string {
  return new Date(resetAtMs).toISOString();
}

function secondsUntilReset(resetAt: string, nowMs: number): number {
  return Math.max(1, Math.ceil((new Date(resetAt).getTime() - nowMs) / 1000));
}

function availableQuota(nowMs: number, cooldownMs: number): ManualRefreshQuota {
  return {
    limit: MANUAL_REFRESH_LIMIT,
    used: 0,
    remaining: MANUAL_REFRESH_LIMIT,
    reset_at: resetAtFromNow(nowMs, cooldownMs),
  };
}

function consumedQuota(resetAtMs: number): ManualRefreshQuota {
  return {
    limit: MANUAL_REFRESH_LIMIT,
    used: MANUAL_REFRESH_LIMIT,
    remaining: 0,
    reset_at: resetAtFromUnixMs(resetAtMs),
  };
}

function publicTargetKey(target: string | null | undefined): string {
  const value = String(target ?? "global").trim();
  return value.replace(/[^0-9A-Za-z:_-]/g, "_").slice(0, 80) || "global";
}

function readPublicResetMap(
  raw: string | undefined,
  nowMs: number
): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [publicTargetKey(key), Number(value)] as const)
        .filter(([, resetAtMs]) => Number.isFinite(resetAtMs) && resetAtMs > nowMs)
    );
  } catch {
    return {};
  }
}

function publicCookieMaxAgeSeconds(
  resetMap: Record<string, number>,
  nowMs: number
): number {
  const resetAtMs = Math.max(...Object.values(resetMap));
  if (!Number.isFinite(resetAtMs)) return 1;
  return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
}

function trimPublicResetMap(
  resetMap: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(resetMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, PUBLIC_REFRESH_COOKIE_ENTRY_LIMIT)
  );
}

function readOwnerResetAtMsFromCookie(
  cookieHeader: string | undefined,
  nowMs: number
): number | null {
  const cookies = parse(cookieHeader ?? "");
  const raw = cookies[OWNER_REFRESH_QUOTA_COOKIE];
  if (!raw) return null;

  const resetAtMs = Number.parseInt(raw, 10);
  if (!Number.isFinite(resetAtMs) || resetAtMs <= nowMs) return null;

  return resetAtMs;
}

function readPublicResetAtMsFromCookie(
  cookieHeader: string | undefined,
  nowMs: number,
  target: string | null | undefined
): number | null {
  const cookies = parse(cookieHeader ?? "");
  const resetMap = readPublicResetMap(cookies[PUBLIC_REFRESH_QUOTA_COOKIE], nowMs);
  return resetMap[publicTargetKey(target)] ?? null;
}

export function getManualRefreshQuota(
  cookieHeader: string | undefined,
  nowMs = Date.now(),
  options: ManualRefreshQuotaOptions = {}
): ManualRefreshQuota {
  const cadence = options.cadence ?? "owner";
  const cooldownMs = cooldownSeconds(cadence) * 1000;
  const resetAtMs =
    cadence === "public"
      ? readPublicResetAtMsFromCookie(cookieHeader, nowMs, options.target)
      : readOwnerResetAtMsFromCookie(cookieHeader, nowMs);
  return resetAtMs
    ? consumedQuota(resetAtMs)
    : availableQuota(nowMs, cooldownMs);
}

export function consumeManualRefreshQuota(
  cookieHeader: string | undefined,
  nowMs = Date.now(),
  options: ManualRefreshQuotaOptions = {}
): { allowed: boolean; quota: ManualRefreshQuota; cookie: string } {
  const cadence = options.cadence ?? "owner";
  const cooldownSecondsValue = cooldownSeconds(cadence);
  const cooldownMs = cooldownSecondsValue * 1000;

  if (cadence === "public") {
    const cookies = parse(cookieHeader ?? "");
    const resetMap = readPublicResetMap(
      cookies[PUBLIC_REFRESH_QUOTA_COOKIE],
      nowMs
    );
    const targetKey = publicTargetKey(options.target);
    const resetAtMs = resetMap[targetKey] ?? null;
    const allowed = resetAtMs === null;
    const quotaResetAtMs = allowed ? nowMs + cooldownMs : resetAtMs;
    resetMap[targetKey] = quotaResetAtMs;
    const nextResetMap = trimPublicResetMap(resetMap);
    const quota = consumedQuota(quotaResetAtMs);

    return {
      allowed,
      quota,
      cookie: serialize(
        PUBLIC_REFRESH_QUOTA_COOKIE,
        JSON.stringify(nextResetMap),
        {
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: publicCookieMaxAgeSeconds(nextResetMap, nowMs),
        }
      ),
    };
  }

  const resetAtMs = readOwnerResetAtMsFromCookie(cookieHeader, nowMs);
  const allowed = resetAtMs === null;
  const quotaResetAtMs = allowed ? nowMs + cooldownMs : resetAtMs;
  const quota = consumedQuota(quotaResetAtMs);

  return {
    allowed,
    quota,
    cookie: serialize(
      OWNER_REFRESH_QUOTA_COOKIE,
      String(quotaResetAtMs),
      {
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: allowed
          ? cooldownSecondsValue
          : secondsUntilReset(quota.reset_at, nowMs),
      }
    ),
  };
}
