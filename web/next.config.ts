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
    locales: ["en", "ru", "zh"],
    defaultLocale: "en",
    // Don't auto-redirect users based on Accept-Language. Canonical URLs
    // stay stable for crawlers, and visitors discover other languages via
    // the switcher / hreflang alternates.
    localeDetection: false,
  },
};

export default withBotId(nextConfig);
