import type { PostHog } from "posthog-js";

let initialized = false;
let cachedClient: PostHog | null = null;

// Reuses the SAME PostHog project as the web viewer, so a person's web + app
// activity stitch into one profile (shared steam_id distinct_id). This is the
// project's PUBLIC, write-only ingestion key — safe to embed (it already ships
// in the public web bundle). Baked in so packaged builds work with no env;
// override at build via VITE_POSTHOG_DESKTOP_TOKEN. Set to "" to disable.
const DEFAULT_TOKEN = "phc_GUppkWFIfGM9WwVbEe33FM7aXn06JkIGWZ5P6MYy5zX";
const KEY = import.meta.env.VITE_POSTHOG_DESKTOP_TOKEN || DEFAULT_TOKEN;
// Electron renderer talks to PostHog directly — there's no Next.js rewrite
// proxy here, so point straight at the EU cluster for both ingest and UI.
const API_HOST = "https://eu.i.posthog.com";
const UI_HOST = "https://eu.i.posthog.com";

// NOTE: telemetry here is ALWAYS on (observability). The `game-tracking-enabled`
// kill switch governs the backend capture feature, not this — so the renderer
// deliberately does not gate its events/replay on any flag.

export async function getPostHog(): Promise<PostHog | null> {
  if (typeof window === "undefined" || !KEY) return null;
  if (cachedClient) return cachedClient;
  const mod = await import("posthog-js");
  const posthog = mod.default;
  if (!initialized) {
    posthog.init(KEY, {
      api_host: API_HOST,
      ui_host: UI_HOST,
      // Single-page Electron app: no real navigation, so disable automatic
      // pageviews and emit manual `tab_viewed` events instead.
      capture_pageview: false,
      autocapture: true,
      // Only create person profiles after `identify()` so events are keyed to
      // the logged-in steam_id rather than anonymous device ids.
      person_profiles: "identified_only",
      // Deliberate product decision (opposite to web): session replay ON.
      // This is a desktop game tracker with low PII and consenting friends,
      // so we keep PostHog's default masking and record everything else.
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: false,
        maskTextSelector: undefined,
      },
    });
    // Shared project with the web viewer — tag every desktop event so web
    // funnels/dashboards can filter on `source`.
    posthog.register({ source: "desktop_app" });

    initialized = true;
  }
  cachedClient = posthog;
  return posthog;
}

/**
 * Best-effort capture; safely no-ops when no token is configured.
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
