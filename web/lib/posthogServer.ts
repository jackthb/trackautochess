type ServerEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

const DEFAULT_POSTHOG_INGEST_HOST = "https://eu.i.posthog.com";

function posthogIngestHost(): string {
  const configured =
    process.env.POSTHOG_API_HOST || process.env.NEXT_PUBLIC_POSTHOG_API_HOST;
  const trimmed = configured?.trim().replace(/\/+$/, "");

  if (!trimmed || trimmed.startsWith("/")) {
    return DEFAULT_POSTHOG_INGEST_HOST;
  }

  return trimmed;
}

function cleanedProperties(
  properties: ServerEventProperties = {},
): Record<string, string | number | boolean> {
  const cleaned: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value == null) continue;
    if (typeof value === "string") {
      cleaned[key] = value.slice(0, 512);
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

export async function captureServerEvent(
  event: string,
  distinctId: string,
  properties: ServerEventProperties = {},
): Promise<void> {
  const token =
    process.env.POSTHOG_PROJECT_TOKEN ||
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token || process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS === "false") return;

  try {
    const resp = await fetch(`${posthogIngestHost()}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        event,
        distinct_id: distinctId,
        properties: cleanedProperties(properties),
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) {
      console.error("PostHog server capture failed:", resp.status, await resp.text());
    }
  } catch (error) {
    console.error("PostHog server capture failed:", error);
  }
}
