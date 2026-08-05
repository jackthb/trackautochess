/**
 * The desktop app signs in through the website, then hands control back to a
 * short-lived HTTP server it runs on localhost. `desktop_return_to` carries
 * that address, so it is attacker-controllable input that ends up in a redirect
 * — it has to be validated on the way in and again on the way out.
 *
 * Both the Steam OpenID entry point and its callback had their own copy of this
 * check, already drifting (one accepted `string`, the other `string | null`).
 * A tightened rule applied to one copy would silently leave the other open, so
 * the allowlist lives here once.
 */
export function loopbackDesktopReturnTo(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isLoopback =
      hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
    // Credentials in the URL would be forwarded to whatever is listening, and
    // a non-loopback or https target means it isn't the local desktop app.
    if (url.protocol !== "http:" || !isLoopback || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
