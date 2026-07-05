import type { IncomingHttpHeaders } from "http";

export const SITE_NAME = "Track Auto Chess";
export const SITE_TITLE = "Track Dota Auto Chess";
export const SITE_DESCRIPTION =
  "Track Auto Chess helps Dota Auto Chess players browse items and relics, read patch notes, and track matches.";
export const DEFAULT_SITE_URL = "https://www.trackautochess.com";
const CANONICAL_HOST = "www.trackautochess.com";
const ROOT_HOST = "trackautochess.com";

function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.hostname === ROOT_HOST || url.hostname === CANONICAL_HOST) {
      url.protocol = "https:";
      url.hostname = CANONICAL_HOST;
      url.port = "";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return withProtocol.replace(/\/+$/, "");
  }
}

export function getSiteUrl(): string | null {
  return normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_SITE_URL;
}

export function getRequestSiteUrl(headers: IncomingHttpHeaders): string | null {
  const forwardedProto = headers["x-forwarded-proto"];
  const forwardedHost = headers["x-forwarded-host"];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || "https";
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || headers.host;

  if (host) {
    const normalized = normalizeUrl(`${proto}://${host}`);
    if (normalized) return normalized;
  }

  return getSiteUrl();
}

/** Extract the origin (scheme + host) from an absolute URL, or null. */
export function originFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function absoluteUrl(
  pathname: string,
  baseUrl: string | null = getSiteUrl()
): string | null {
  if (!baseUrl) return null;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${normalizedPath}`;
}
