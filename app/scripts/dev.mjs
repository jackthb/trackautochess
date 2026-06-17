import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const children = new Set();
const appRoot = process.cwd();
// Resolve bins via Node module resolution so they work whether dependencies are
// installed app-local or hoisted to the workspace root (.npmrc node-linker=hoisted).
// vite's package.json "exports" blocks the bin subpath, so derive it from the
// package dir instead.
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const electronBin = require.resolve("electron/cli.js");

function spawnChild(label, command, args) {
  const child = spawn(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  child.on("error", (error) => {
    console.error(`Failed to start ${label}: ${error.message}`);
    shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

function waitForVite(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, 250);
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    check();
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

const vite = spawnChild("Vite", process.execPath, [viteBin, "--host", "127.0.0.1"]);

try {
  await waitForVite("http://127.0.0.1:5173");
} catch (error) {
  console.error(error.message);
  shutdown(1);
}

const electron = spawnChild("Electron", process.execPath, [electronBin, ".", "--dev"]);
electron.on("exit", (code) => {
  if (!vite.killed) vite.kill();
  if (code && code !== 0) {
    console.error(`Electron exited with code ${code}`);
  }
  process.exit(code ?? 0);
});
