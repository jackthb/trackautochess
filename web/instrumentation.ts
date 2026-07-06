export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) return;

  void import("@/instrumentation.node");
}
