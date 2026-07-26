import type { IncomingHttpHeaders } from "http";
import type { Metadata } from "next";

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

const DEFAULT_OG_IMAGE = "/logo.svg";
const DEFAULT_ROBOTS = "index, follow, max-image-preview:large";

export interface PageMetadataInput {
  title: string;
  description: string;
  /**
   * Canonical path, e.g. "/units" or `/units/${slug}`. Feeds both
   * `alternates.canonical` and `openGraph.url`, which every page previously
   * had to keep in sync by hand.
   */
  path: string;
  /** "website" for index pages, "article" for entity/detail pages. */
  type?: "website" | "article";
  /** Preview image for OpenGraph and Twitter; defaults to the site logo. */
  image?: string;
  /** Robots directive; pass null to omit the tag entirely. */
  robots?: string | null;
}

/**
 * The standard page head for this site.
 *
 * Seventeen pages carried this literal inline and two had already drifted —
 * /queens lost `openGraph.locale` and /creators lost `robots` — so callers now
 * supply only what actually varies.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  image = DEFAULT_OG_IMAGE,
  robots = DEFAULT_ROBOTS,
}: PageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(robots ? { robots } : {}),
    openGraph: {
      title,
      description,
      type,
      siteName: SITE_NAME,
      url: path,
      locale: "en_US",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
