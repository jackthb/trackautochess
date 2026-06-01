import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dac/shared"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // i18n routing was removed (en/ru/zh; ~3.4% of traffic, little translated
  // content). The site now serves a single English locale; localization will
  // be rebuilt on the App Router via next-intl when there's a reason to. The
  // /ru/* and /zh/* redirects below preserve link equity for the old URLs.
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
  // The old locale-prefixed URLs now redirect to their English equivalents so
  // existing links and indexed pages don't 404. Covers /ru/privacy -> /privacy
  // (App Router) and e.g. /ru/units/abaddon -> /units/abaddon (Pages Router).
  async redirects() {
    return [
      { source: "/ru/:path*", destination: "/:path*", permanent: true },
      { source: "/zh/:path*", destination: "/:path*", permanent: true },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default withBotId(nextConfig);
