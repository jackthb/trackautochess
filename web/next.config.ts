import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dac/shared"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default withBotId(nextConfig);
