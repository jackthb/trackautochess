/**
 * Lazy-singleton plumbing shared by the desktop renderer and the web viewer.
 *
 * The two apps deliberately configure PostHog differently — the Electron
 * renderer talks to the EU cluster directly with session replay disabled, the web
 * viewer goes through a first-party `/ingest` proxy and honours a cookie
 * banner — and they import different `posthog-js` entrypoints. What they do NOT
 * differ on is the lifecycle around that config: guard on SSR and on a missing
 * key, dynamically import once, run `init` once, cache the client, and wrap
 * every call site in a best-effort fire-and-forget. Both had a hand-written
 * copy of that; this owns it, and each app supplies only what actually varies.
 */

/** The subset of the PostHog client surface these bindings touch. */
export interface PostHogLike {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
  captureException?: (
    error: unknown,
    additionalProperties?: Record<string, unknown>
  ) => void;
}

export interface LazyPostHogOptions<T extends PostHogLike> {
  /**
   * Whether telemetry should run at all — a missing project token, a kill
   * switch, anything static. Checked before the dynamic import, so a disabled
   * app never pays for the bundle.
   */
  enabled: () => boolean;
  /** Dynamically imports the client. Called at most once. */
  load: () => Promise<T>;
  /** Configures the freshly loaded client. Called at most once. */
  init: (client: T) => void;
}

export interface PostHogBindings<T extends PostHogLike> {
  /** Resolves the configured client, or null when telemetry is off or SSR. */
  getPostHog: () => Promise<T | null>;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
  captureException: (
    error: unknown,
    additionalProperties?: Record<string, unknown>
  ) => void;
}

export function createLazyPostHog<T extends PostHogLike>(
  options: LazyPostHogOptions<T>
): PostHogBindings<T> {
  let initialized = false;
  let cachedClient: T | null = null;

  const getPostHog = async (): Promise<T | null> => {
    if (typeof window === "undefined" || !options.enabled()) return null;
    if (cachedClient) return cachedClient;
    const client = await options.load();
    if (!initialized) {
      options.init(client);
      initialized = true;
    }
    cachedClient = client;
    return client;
  };

  // Best-effort by design: telemetry must never reject into a caller's flow,
  // and safely no-ops when no token is configured.
  return {
    getPostHog,
    capture: (event, properties) => {
      void getPostHog().then((ph) => ph?.capture(event, properties));
    },
    identify: (distinctId, properties) => {
      void getPostHog().then((ph) => ph?.identify(distinctId, properties));
    },
    reset: () => {
      void getPostHog().then((ph) => ph?.reset());
    },
    captureException: (error, additionalProperties) => {
      void getPostHog().then((ph) =>
        ph?.captureException?.(error, additionalProperties)
      );
    },
  };
}
