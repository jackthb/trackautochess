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
const OWNER_REFRESH_COOLDOWN_SECONDS = 15 * 60;
const PUBLIC_REFRESH_COOLDOWN_SECONDS = 24 * 60 * 60;
const PUBLIC_REFRESH_COOKIE_ENTRY_LIMIT = 50;
const OWNER_MANUAL_REFRESH_LIMIT = 5;
const PUBLIC_MANUAL_REFRESH_LIMIT = 1;

interface OwnerRefreshState {
  resetAtMs: number;
  used: number;
}

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

function limitForCadence(cadence: ManualRefreshCadence): number {
  return cadence === "owner"
    ? OWNER_MANUAL_REFRESH_LIMIT
    : PUBLIC_MANUAL_REFRESH_LIMIT;
}

function availableQuota(
  cadence: ManualRefreshCadence,
  nowMs: number,
  cooldownMs: number
): ManualRefreshQuota {
  const limit = limitForCadence(cadence);
  return {
    limit,
    used: 0,
    remaining: limit,
    reset_at: resetAtFromNow(nowMs, cooldownMs),
  };
}

function quotaFromUsage(
  cadence: ManualRefreshCadence,
  used: number,
  resetAtMs: number
): ManualRefreshQuota {
  const limit = limitForCadence(cadence);
  const safeUsed = Math.max(0, Math.min(limit, used));
  return {
    limit,
    used: safeUsed,
    remaining: Math.max(0, limit - safeUsed),
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

function readOwnerStateFromCookie(
  cookieHeader: string | undefined,
  nowMs: number
): OwnerRefreshState | null {
  const cookies = parse(cookieHeader ?? "");
  const raw = cookies[OWNER_REFRESH_QUOTA_COOKIE];
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const resetAtMs = Number(record.resetAtMs);
      const used = Number(record.used);
      if (
        Number.isFinite(resetAtMs) &&
        resetAtMs > nowMs &&
        Number.isFinite(used) &&
        used > 0
      ) {
        return { resetAtMs, used };
      }
    }
  } catch {
    // Fall through to the legacy timestamp-only cookie format below.
  }

  const legacyResetAtMs = Number.parseInt(raw, 10);
  if (!Number.isFinite(legacyResetAtMs) || legacyResetAtMs <= nowMs) return null;

  return { resetAtMs: legacyResetAtMs, used: OWNER_MANUAL_REFRESH_LIMIT };
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
  if (cadence === "public") {
    const resetAtMs = readPublicResetAtMsFromCookie(
      cookieHeader,
      nowMs,
      options.target
    );
    return resetAtMs
      ? quotaFromUsage(cadence, PUBLIC_MANUAL_REFRESH_LIMIT, resetAtMs)
      : availableQuota(cadence, nowMs, cooldownMs);
  }

  const ownerState = readOwnerStateFromCookie(cookieHeader, nowMs);
  return ownerState
    ? quotaFromUsage(cadence, ownerState.used, ownerState.resetAtMs)
    : availableQuota(cadence, nowMs, cooldownMs);
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
    const quota = quotaFromUsage(cadence, PUBLIC_MANUAL_REFRESH_LIMIT, quotaResetAtMs);

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

  const ownerState = readOwnerStateFromCookie(cookieHeader, nowMs);
  const previousUsed = ownerState?.used ?? 0;
  const allowed = previousUsed < OWNER_MANUAL_REFRESH_LIMIT;
  const quotaResetAtMs = ownerState?.resetAtMs ?? nowMs + cooldownMs;
  const nextUsed = allowed ? previousUsed + 1 : previousUsed;
  const quota = quotaFromUsage(cadence, nextUsed, quotaResetAtMs);

  return {
    allowed,
    quota,
    cookie: serialize(
      OWNER_REFRESH_QUOTA_COOKIE,
      JSON.stringify({ resetAtMs: quotaResetAtMs, used: nextUsed }),
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
