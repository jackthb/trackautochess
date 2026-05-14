import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${port}`;

function firstExistingPath(paths: Array<string | undefined>) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

const chromiumExecutablePath = firstExistingPath([
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : undefined,
  process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : undefined,
  process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
]);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  webServer: {
    command: "pnpm run start",
    env: {
      PORT: String(port),
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    browserName: "chromium",
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : undefined,
    trace: "retain-on-failure",
  },
});
