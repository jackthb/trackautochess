type FlagValue =
  | boolean
  | string
  | null
  | undefined
  | {
      enabled?: boolean;
      variant?: string | null;
      value?: boolean | string | null;
    };

interface FlagsResponse {
  flags?: Record<string, FlagValue>;
  featureFlags?: Record<string, FlagValue>;
}

export type PostHogFlagProbe = {
  enabled: boolean;
  host: string;
  hasToken: boolean;
  httpStatus: number | null;
  flagPresent: boolean;
  raw: FlagValue;
  error: string | null;
};

function posthogFlagsHost(): string {
  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_API_HOST?.trim();
  if (apiHost && /^https?:\/\//i.test(apiHost)) {
    return apiHost.replace(/\/+$/, "");
  }
  return "https://eu.i.posthog.com";
}

function flagEnabled(value: FlagValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "false";
  if (value && typeof value === "object") {
    if (typeof value.enabled === "boolean") return value.enabled;
    if (typeof value.value === "boolean") return value.value;
    if (typeof value.value === "string") return value.value !== "false";
    return Boolean(value.variant);
  }
  return false;
}

export async function probePostHogFlagForSteamId(
  steamId: string | null | undefined,
  flagKey: string,
): Promise<PostHogFlagProbe> {
  const token =
    process.env.POSTHOG_PROJECT_TOKEN ||
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = posthogFlagsHost();

  if (process.env.NODE_ENV === "development") {
    return {
      enabled: Boolean(steamId),
      host,
      hasToken: Boolean(token),
      httpStatus: null,
      flagPresent: false,
      raw: undefined,
      error: steamId ? null : "missing_steam_id",
    };
  }

  if (!token || !steamId) {
    return {
      enabled: false,
      host,
      hasToken: Boolean(token),
      httpStatus: null,
      flagPresent: false,
      raw: undefined,
      error: !steamId ? "missing_steam_id" : "missing_project_token",
    };
  }

  try {
    const resp = await fetch(`${host}/flags?v=2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        distinct_id: steamId,
      }),
      cache: "no-store",
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return {
        enabled: false,
        host,
        hasToken: true,
        httpStatus: resp.status,
        flagPresent: false,
        raw: undefined,
        error: detail.slice(0, 300) || `http_${resp.status}`,
      };
    }

    const data = (await resp.json()) as FlagsResponse;
    const raw = data.flags?.[flagKey] ?? data.featureFlags?.[flagKey];
    return {
      enabled: flagEnabled(raw),
      host,
      hasToken: true,
      httpStatus: resp.status,
      flagPresent: raw !== undefined,
      raw,
      error: null,
    };
  } catch (err) {
    return {
      enabled: false,
      host,
      hasToken: true,
      httpStatus: null,
      flagPresent: false,
      raw: undefined,
      error: err instanceof Error ? err.message : "fetch_failed",
    };
  }
}

export async function isPostHogFlagEnabledForSteamId(
  steamId: string | null | undefined,
  flagKey: string,
): Promise<boolean> {
  const probe = await probePostHogFlagForSteamId(steamId, flagKey);
  return probe.enabled;
}
