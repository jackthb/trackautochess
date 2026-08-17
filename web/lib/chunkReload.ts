/**
 * Recovery for Next.js "version skew" chunk loads.
 *
 * Every deploy rotates the content-hashed Turbopack chunk filenames. A tab
 * that was opened against the previous deploy still holds the old filenames in
 * its already-parsed markup, so the next lazy `import()` it makes fetches a
 * chunk hash the CDN no longer serves and throws a `ChunkLoadError`. The fix
 * is simply to reload onto the current deploy — the error boundaries below
 * call into this to do that automatically, once, without risking a loop.
 */

// One hard reload is enough to land on the fresh deploy. If the boundary
// re-mounts within this window the reload plainly did NOT fix things (a real,
// reproducible error rather than skew), so we stop auto-reloading and hand the
// user a manual recovery UI instead of looping forever. A later chunk error in
// the same tab (a subsequent deploy) falls outside the window and reloads
// again, which is what we want.
const RELOAD_GUARD_KEY = "dac.chunkReload.at";
const RELOAD_GUARD_WINDOW_MS = 10_000;

/**
 * Whether a caught error is a failed chunk/module load rather than an
 * application bug. Covers webpack's `ChunkLoadError` name, Turbopack's
 * "Failed to load chunk", and the browser-native dynamic-import messages.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  const name = typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  if (name === "ChunkLoadError") return true;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message)
          : "";

  return /loading chunk|failed to load chunk|importing a module script failed|error loading dynamically imported module|failed to fetch dynamically imported module/i.test(
    message,
  );
}

/**
 * Trigger a single guarded reload onto the current deploy.
 *
 * Returns `true` when a reload was scheduled (the caller should render a brief
 * "updating" state while the navigation happens) and `false` when the guard
 * suppressed it because we already reloaded moments ago (the caller should
 * render a manual recovery UI instead of looping).
 */
export function attemptChunkReload(): boolean {
  if (typeof window === "undefined") return false;

  let lastReloadAt = 0;
  try {
    lastReloadAt = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0;
  } catch {
    // sessionStorage can throw in private-mode / sandboxed frames; treat an
    // inaccessible store as "never reloaded" and fall through to a best-effort
    // one-shot reload.
    lastReloadAt = 0;
  }

  const now = Date.now();
  if (lastReloadAt && now - lastReloadAt < RELOAD_GUARD_WINDOW_MS) {
    return false;
  }

  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    // Ignore — worst case we reload one extra time, which the window still
    // bounds, and it beats stranding the user.
  }

  window.location.reload();
  return true;
}
