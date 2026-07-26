import { createLazyPostHog } from "@dac/shared/posthog";

type PostHogClient = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  captureException: (error: unknown, additionalProperties?: Record<string, unknown>) => void;
  displaySurvey: (
    surveyId: string,
    options: {
      displayType: "inline" | "popover" | "widget";
      selector?: string;
      ignoreConditions?: boolean;
      ignoreDelay?: boolean;
      properties?: Record<string, unknown>;
    },
  ) => void;
  getActiveMatchingSurveys: (
    callback: (
      surveys: Array<{ id: string; name?: string }>,
      context?: { isLoaded?: boolean; error?: string },
    ) => void,
    forceReload?: boolean,
  ) => void;
  getSurveys: (
    callback: (
      surveys: Array<{
        id: string;
        name?: string;
        description?: string;
        type?: string;
        start_date?: string | null;
        end_date?: string | null;
        archived?: boolean;
      }>,
      context?: { isLoaded?: boolean; error?: string },
    ) => void,
    forceReload?: boolean,
  ) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  init: (token: string, config: Record<string, unknown>) => void;
  isFeatureEnabled: (flagKey: string) => boolean | undefined;
  onFeatureFlags: (callback: () => void) => () => void;
  onSurveysLoaded?: (callback: () => void) => void;
  register: (properties: Record<string, unknown>) => void;
  reloadFeatureFlags: () => void;
  reset: () => void;
  startSessionRecording: (
    override?: boolean | { sampling?: boolean; linked_flag?: boolean },
  ) => void;
};

// Reuses the SAME PostHog project as the web viewer, so a person's web + app
// activity stitch into one profile (shared steam_id distinct_id). This is the
// project's PUBLIC, write-only ingestion key — safe to embed (it already ships
// in the public web bundle). Baked in so packaged builds work with no env;
// override at build via VITE_POSTHOG_DESKTOP_TOKEN. Set to "" to disable.
const DEFAULT_TOKEN = "phc_GUppkWFIfGM9WwVbEe33FM7aXn06JkIGWZ5P6MYy5zX";
const configuredToken = import.meta.env.VITE_POSTHOG_DESKTOP_TOKEN;
const KEY =
  configuredToken === undefined ? DEFAULT_TOKEN : configuredToken.trim();
// Electron renderer talks to PostHog directly — there's no Next.js rewrite
// proxy here; ingest goes to the EU cluster and UI links go to the PostHog app.
const API_HOST = "https://eu.i.posthog.com";
const UI_HOST = "https://eu.posthog.com";

// NOTE: telemetry here is ALWAYS on (observability). The `game-tracking-enabled`
// kill switch governs the backend capture feature, not this — so the renderer
// deliberately does not gate its events/replay on any flag.

export const { getPostHog, capture, captureException, identify, reset } =
  createLazyPostHog<PostHogClient>({
    enabled: () => Boolean(KEY),
    load: async () =>
      (await import("posthog-js/dist/module.full.no-external"))
        .default as PostHogClient,
    init: (posthog) => {
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
        surveys: true,
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

      // Force replay on for every desktop app session. Passing `true` overrides
      // sampling / linked-flag controls for this recording session, so packaged
      // clients don't silently depend on project defaults.
      posthog.startSessionRecording(true);
    },
  });
