import type { PostHog } from "posthog-js";
import { createLazyPostHog } from "@dac/shared/posthog";

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

export const { getPostHog, capture, identify, reset } =
  createLazyPostHog<PostHog>({
    // Honor the global product-analytics kill switch from lib/analytics.
    enabled: () =>
      Boolean(KEY) && process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS !== "false",
    load: async () => (await import("posthog-js")).default,
    init: (posthog) => {
      posthog.init(KEY!, {
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
    },
  });
