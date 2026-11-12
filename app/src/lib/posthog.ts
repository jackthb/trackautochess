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

// Ordinary product analytics remain independent of backend game capture.
// Session replay is disabled until an explicit consent flow is implemented.

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
        // Do not record desktop sessions without an explicit consent flow.
        // Keep defensive masking configured if replay is introduced later.
        disable_session_recording: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "*",
        },
      });
      // Shared project with the web viewer — tag every desktop event so web
      // funnels/dashboards can filter on `source`.
      posthog.register({ source: "desktop_app" });

    },
  });
