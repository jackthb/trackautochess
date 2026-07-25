import { captureException } from "./posthog";

/**
 * Reports crashes from every process that can fail to the same PostHog
 * project: renderer exceptions caught here directly, Electron main-process
 * errors forwarded over `appApi.onError`, and Rust backend panics forwarded
 * over the existing tracker event stream as a `panic` event.
 */
export function initErrorReporting(): () => void {
  const onWindowError = (event: ErrorEvent) => {
    captureException(event.error ?? new Error(event.message), { source: "renderer" });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    captureException(event.reason, { source: "renderer" });
  };
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  const unsubscribeMain = window.appApi.onError((payload) => {
    const error = new Error(payload.message);
    error.stack = payload.stack;
    captureException(error, { source: `main:${payload.source}` });
  });

  const unsubscribeTracker = window.tracker?.onEvent((msg) => {
    if (msg.type !== "panic") return;
    captureException(new Error(msg.message || "Rust backend panic"), {
      source: "rust",
      location: msg.location,
    });
  });

  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    unsubscribeMain?.();
    unsubscribeTracker?.();
  };
}
