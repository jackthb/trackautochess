import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getElectronDesktopPaths } = require("./desktop-paths.cjs");
const repoDir = path.resolve(__dirname, "..");
const appDir = path.join(repoDir, "app");
const desktopPaths = getElectronDesktopPaths(appDir, { isPackaged: false });
const dacDir = desktopPaths.dacDir;
const { command, args, cwd } = desktopPaths.backendCommand;

const child = spawn(command, args, {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    DAC_DIR: dacDir,
    PYTHONUNBUFFERED: "1",
  },
});

let settled = false;
let stderr = "";
let sawStatus = false;

function fail(message) {
  if (settled) return;
  settled = true;
  child.kill("SIGTERM");
  console.error(message);
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(1);
}

function succeed() {
  if (settled) return;
  settled = true;
  child.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
}

const timer = setTimeout(() => {
  fail("Timed out waiting for backend startup.");
}, 30000);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === "status") {
        sawStatus = true;
        succeed();
      }
    } catch {
      // Ignore non-JSON noise from cargo build/run.
    }
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.on("error", (error) => {
  clearTimeout(timer);
  fail(`Failed to start backend (${desktopPaths.backendKind}): ${error.message}`);
});

child.on("exit", (code) => {
  clearTimeout(timer);
  if (!settled && code !== 0) {
    fail(`Backend exited before readiness check completed (code ${code}).`);
    return;
  }
  if (sawStatus && code === 0) {
    console.log(`${desktopPaths.backendKind} backend startup verified.`);
    process.exit(0);
    return;
  }
  if (sawStatus) {
    fail(`Backend exited after readiness check with code ${code}.`);
    return;
  }
  if (!sawStatus) {
    fail(`Backend exited without emitting status (code ${code}).`);
  }
});
