import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withPostHogConfig } from "@posthog/nextjs-config";
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
  // Version-skew protection: stamp every asset/data request with the deploy it
  // was served by so an open tab keeps loading chunks from *its* deployment
  // even after a newer one ships (removing the cause of the ChunkLoadError the
  // error boundaries recover from). `VERCEL_DEPLOYMENT_ID` is injected on
  // Vercel when Skew Protection is enabled for the project; it is undefined
  // locally, where this is a harmless no-op.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
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
    resolveAlias: {
      "@tailwindcss/postcss": path.resolve(
        __dirname,
        "..",
        "node_modules",
        "@tailwindcss",
        "postcss",
      ),
    },
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

// Upload browser source maps to PostHog during `next build` so client stack
// traces symbolicate instead of pointing at minified frames. Gated on
// POSTHOG_API_KEY, so local and preview builds without the secret skip the
// upload rather than fail. deleteAfterUpload keeps the maps off the public CDN.
const sourceMapUploadEnabled = Boolean(
  process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID,
);
if (process.env.VERCEL_ENV === "production" && !sourceMapUploadEnabled) {
  console.warn(
    "[PostHog] Source map uploads are disabled: configure POSTHOG_API_KEY and POSTHOG_PROJECT_ID. Client errors will have minified stack traces.",
  );
}
export default withPostHogConfig(withBotId(nextConfig), {
  personalApiKey: process.env.POSTHOG_API_KEY ?? "",
  projectId: process.env.POSTHOG_PROJECT_ID,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.posthog.com",
  sourcemaps: {
    enabled: sourceMapUploadEnabled,
    deleteAfterUpload: true,
  },
});
