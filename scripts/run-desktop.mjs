import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const mode = process.argv[2];

if (!mode || !["dev", "start"].includes(mode)) {
  console.error("Usage: node scripts/run-desktop.mjs <dev|start>");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getRepoDesktopPaths } = require("./desktop-paths.cjs");
const repoDir = path.resolve(__dirname, "..");
const desktopPaths = getRepoDesktopPaths(repoDir);
const dacDir = desktopPaths.dacDir;
if (desktopPaths.backendKind === "python" && !existsSync(desktopPaths.backendPythonPath)) {
  console.error("Desktop Python backend is not installed. Run `npm run install:desktop` first.");
  process.exit(1);
}

const child = spawn("corepack", ["pnpm", "--dir", "app", "run", mode], {
  cwd: repoDir,
  stdio: "inherit",
  env: {
    ...process.env,
    DAC_DIR: dacDir,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
