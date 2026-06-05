import { capture as posthogCapture } from "@/lib/posthog";

type AnalyticsValue = string | number | boolean | null | undefined;
export type AnalyticsProperties = Record<string, AnalyticsValue>;

const MAX_STRING_LENGTH = 96;
const SENSITIVE_PROPERTY_PATTERN =
  /(^|_)(access|email|id|name|query|steam|token|url)($|_)/i;

export function bucketCount(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 3) return "2-3";
  if (count <= 10) return "4-10";
  if (count <= 25) return "11-25";
  if (count <= 100) return "26-100";
  return "100+";
}

export function analyticsRoute(pathname: string): string {
  const localeMatch = pathname.match(/^\/(en|ru)(?=\/|$)/);
  const prefix = localeMatch?.[0] ?? "";
  const path = prefix ? pathname.slice(prefix.length) || "/" : pathname;

  const redacted = path
    .replace(/^\/players\/[^/?#]+/, "/players/[player]")
    .replace(/^\/games\/[^/?#]+/, "/games/[game]")
    .replace(/^\/items\/[^/?#]+/, "/items/[item]")
    .replace(/^\/units\/[^/?#]+/, "/units/[unit]")
    .replace(/^\/synergies\/[^/?#]+/, "/synergies/[synergy]")
    .replace(/^\/relics\/[^/?#]+/, "/relics/[relic]")
    .replace(/^\/patch-notes\/[^/?#]+/, "/patch-notes/[patch]");

  return `${prefix}${redacted}`;
}

export function trackEvent(
  name: string,
  properties: AnalyticsProperties = {},
): void {
  if (typeof window === "undefined") return;
  if (process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS === "false") return;

  const cleaned = sanitizeProperties(properties);
  try {
    posthogCapture(name, cleaned);
    if (process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === "true") {
      console.debug("[analytics]", name, cleaned);
    }
  } catch (error) {
    if (process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === "true") {
      console.debug("[analytics failed]", name, error);
    }
  }
}

function sanitizeProperties(
  properties: AnalyticsProperties,
): Record<string, string | number | boolean> {
  const cleaned: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value == null || SENSITIVE_PROPERTY_PATTERN.test(key)) continue;
    if (typeof value === "string") {
      cleaned[key] = value.slice(0, MAX_STRING_LENGTH);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      cleaned[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      cleaned[key] = value;
    }
  }

  return cleaned;
}
