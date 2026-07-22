import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@dac/shared": path.resolve(__dirname, "../shared"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Emit source maps so PostHog error tracking can symbolicate minified
    // renderer frames (e.g. the NetTableSetupCard crashes) back to real source.
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
