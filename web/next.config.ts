import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dac/shared"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  i18n: {
    locales: ["en", "ru"],
    defaultLocale: "en",
    // Don't auto-redirect users based on Accept-Language. Canonical URLs
    // stay stable for crawlers, and visitors discover other languages via
    // the switcher / hreflang alternates.
    localeDetection: false,
  },
  async headers() {
    const immutableAssetCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ];

    return [
      {
        source: "/fonts/:path*",
        locale: false,
        headers: immutableAssetCache,
      },
      {
        source: "/icons/:path*",
        locale: false,
        headers: immutableAssetCache,
      },
      {
        source: "/logo.svg",
        locale: false,
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/favicon.ico",
        locale: false,
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  // Proxy PostHog ingest through our own origin so ad blockers don't drop
  // analytics requests targeting eu.i.posthog.com. Matches the rewrites the
  // PostHog setup wizard installs; lib/posthog.ts sets api_host="/ingest".
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://eu.i.posthog.com/decide",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default withBotId(nextConfig);
