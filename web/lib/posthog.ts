import type { PostHog } from "posthog-js";

let initialized = false;
let cachedClient: PostHog | null = null;

const KEY = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
// Events are sent through a first-party proxy so ad blockers targeting
// *.posthog.com don't drop them. For PostHog managed proxy, set this to a
// neutral subdomain root such as https://t.trackautochess.com.
const API_HOST = normalizeApiHost(process.env.NEXT_PUBLIC_POSTHOG_API_HOST);
const UI_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.posthog.com";

function normalizeApiHost(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "/ingest";
  return trimmed.replace(/\/+$/, "") || "/ingest";
}

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
      // Session replay ON. Naturally gated to consenting users: PostHog won't
      // record visitors who hit "Decline" (opt_out_capturing), and cost can be
      // capped via the project-level sample rate. Was previously off by default.
      disable_session_recording: false,
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
