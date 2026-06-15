import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { cpSync, existsSync, mkdirSync } from "fs";
import path from "path";

function syncPublicIcons() {
  const source = path.resolve(__dirname, "..", "data", "icons");
  const destination = path.resolve(__dirname, "public", "icons");

  if (!existsSync(source)) {
    console.warn(`[next-config] Missing icon source directory: ${source}`);
    return;
  }

  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

// Vercel may invoke `next build` directly, bypassing package.json prebuild.
// Keep gitignored public icons present before Next snapshots static assets.
syncPublicIcons();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dac/shared"],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@dac/shared": path.resolve(__dirname, "..", "shared"),
    };
    return config;
  },
  // Native addon used by the OG-image routes (satori -> PNG). Must not be
  // bundled by the App Router; Pages API routes externalized it automatically.
  serverExternalPackages: ["@resvg/resvg-js"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // i18n routing was removed (en/ru/zh; ~3.4% of traffic, little translated
  // content). The site now serves a single English locale; localization will
  // be rebuilt on the App Router via next-intl when there's a reason to.
  async headers() {
    const immutableAssetCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ];
    const immutableImageCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
      {
        key: "CDN-Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
      {
        key: "Vercel-CDN-Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ];

    return [
      {
        source: "/icons/:path*",
        locale: false,
        headers: immutableImageCache,
      },
      {
        source: "/fonts/:path*",
        locale: false,
        headers: immutableAssetCache,
      },
      {
        source: "/logo.svg",
        locale: false,
        headers: immutableImageCache,
      },
      {
        source: "/favicon.ico",
        locale: false,
        headers: immutableImageCache,
      },
    ];
  },
  // Self-hosted fallback for local/dev when NEXT_PUBLIC_POSTHOG_API_HOST is not
  // configured. Production should use the PostHog managed proxy domain instead.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://eu-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  async redirects() {
    return [
      // /synergies is an alias for the classes listing (was a getServerSideProps
      // redirect in pages/synergies.tsx before the App Router migration).
      { source: "/synergies", destination: "/classes", permanent: true },
      { source: "/admin/matches", destination: "/matches", permanent: false },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default withBotId(nextConfig);
