import type { PostHog } from "posthog-js";

let initialized = false;
let cachedClient: PostHog | null = null;

const KEY = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
// Events are sent through /ingest (rewritten in next.config.ts to the EU
// PostHog cluster) so ad blockers targeting *.posthog.com don't drop them.
// UI host stays at the public domain so toolbar/links still resolve.
const API_HOST = "/ingest";
const UI_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

export async function getPostHog(): Promise<PostHog | null> {
  if (typeof window === "undefined" || !KEY) return null;
  // Honor the global product-analytics kill switch from lib/analytics.
  if (process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS === "false") return null;
  if (cachedClient) return cachedClient;
  const mod = await import("posthog-js");
  const posthog = mod.default;
  if (!initialized) {
    posthog.init(KEY, {
      api_host: API_HOST,
      ui_host: UI_HOST,
      // Auto-capture clicks, inputs, and route changes (Next pages router).
      capture_pageview: "history_change",
      autocapture: true,
      // Only create person profiles after `identify()` to keep MAU low and
      // respect anonymous visitors who never sign in.
      person_profiles: "identified_only",
      // Cost + privacy: session replay stays off until explicitly enabled.
      disable_session_recording: true,
      // Do not set PostHog cookies until the visitor explicitly accepts.
      cookieless_mode: "on_reject",
      respect_dnt: true,
    });
    initialized = true;
  }
  cachedClient = posthog;
  return posthog;
}

/**
 * Best-effort capture; safely no-ops in dev (no env var) and in SSR.
 */
export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  void getPostHog().then((ph) => ph?.capture(event, properties));
}

export function identify(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  void getPostHog().then((ph) => ph?.identify(distinctId, properties));
}

export function reset(): void {
  void getPostHog().then((ph) => ph?.reset());
}
