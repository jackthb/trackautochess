import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(__dirname, "..");
const toolsBinDir = path.join(repoDir, "tools", "bin");
const electronBuilderCli = path.join(repoDir, "app", "node_modules", "electron-builder", "cli.js");
const spawnPatch = path.join(__dirname, "electron-builder-spawn-fix.cjs");
const cacheRoot = path.join(repoDir, ".electron-builder-cache");
const args = process.argv.slice(2);
const signingConfigured = Boolean(
  process.env.WIN_CSC_LINK ||
    process.env.CSC_LINK ||
    process.env.WIN_CSC_SHA1 ||
    process.env.WIN_CSC_AUTO === "1"
);
const effectiveArgs = signingConfigured
  ? args
  : [...args, "--config.win.signAndEditExecutable=false"];

const child = spawn(
  process.execPath,
  [
    "--require",
    spawnPatch,
    electronBuilderCli,
    ...effectiveArgs,
    "--config",
    "electron-builder.json",
  ],
  {
    cwd: path.join(repoDir, "app"),
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_BUILDER_CACHE: path.join(cacheRoot, "electron-builder"),
      PATH: `${toolsBinDir}${path.delimiter}${process.env.PATH || ""}`,
      XDG_CACHE_HOME: cacheRoot,
    },
  },
);

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
