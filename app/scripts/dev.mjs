import { spawn } from "node:child_process";
import http from "node:http";

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const children = new Set();

function spawnChild(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: isWindows,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  child.on("error", (error) => {
    console.error(error.message);
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

const vite = spawnChild(pnpm, ["exec", "vite", "--host", "127.0.0.1"]);

try {
  await waitForVite("http://127.0.0.1:5173");
} catch (error) {
  console.error(error.message);
  shutdown(1);
}

const electron = spawnChild(pnpm, ["exec", "electron", ".", "--dev"]);
electron.on("exit", (code) => {
  if (!vite.killed) vite.kill();
  process.exit(code ?? 0);
});
