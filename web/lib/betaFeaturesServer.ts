import { WEBSITE_BETA_FEATURES_FLAG } from "@/lib/betaFlags";

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

export async function isBetaFeaturesEnabledForSteamId(
  steamId: string | null | undefined,
): Promise<boolean> {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token || !steamId) return false;

  try {
    const resp = await fetch(`${posthogFlagsHost()}/flags?v=2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        distinct_id: steamId,
      }),
      cache: "no-store",
    });
    if (!resp.ok) return false;

    const data = (await resp.json()) as FlagsResponse;
    return flagEnabled(
      data.flags?.[WEBSITE_BETA_FEATURES_FLAG] ??
        data.featureFlags?.[WEBSITE_BETA_FEATURES_FLAG]
    );
  } catch {
    return false;
  }
}
