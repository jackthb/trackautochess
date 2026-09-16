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

function isOwnBundleFrame(frame: unknown): boolean {
  const filename = (frame as { filename?: unknown } | null)?.filename;
  return typeof filename === "string" && filename.includes("/_next/");
}

/**
 * Suppress known injected scripts while retaining ambiguous stacks. Missing
 * Next.js frames alone do not prove a foreign error: inline scripts, native
 * frames and manually captured errors can also lack a bundle filename.
 */
export function isForeignScriptException(event: {
  event?: string;
  properties?: Record<string, unknown> | null;
}): boolean {
  if (event.event !== "$exception") return false;
  const exceptions = event.properties?.$exception_list;
  if (!Array.isArray(exceptions)) return false;
  if (exceptions.length === 0) return false;
  return exceptions.every((exception) => {
    const frames: unknown[] = Array.isArray(exception?.stacktrace?.frames)
      ? exception.stacktrace.frames
      : [];
    if (frames.length === 0 || frames.some(isOwnBundleFrame)) return false;
    const knownReaderError = typeof exception?.value === "string" &&
      exception.value.includes("window.__firefox__.reader");
    return frames.every((frame) => {
      const filename = (frame as { filename?: unknown } | null)?.filename;
      if (typeof filename !== "string") return false;
      if (/^(?:chrome|moz|safari-web)-extension:\/\//i.test(filename)) return true;
      return knownReaderError && typeof event.properties?.$current_url === "string" &&
        filename === event.properties.$current_url;
    });
  });
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
        // Suppress recognizable browser injection; retain uncertain errors.
        before_send: (event) =>
          event && isForeignScriptException(event) ? null : event,
      });
    },
  });
