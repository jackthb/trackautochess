import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getRepoDesktopPaths } = require("./desktop-paths.cjs");
const repoDir = path.resolve(__dirname, "..");
const desktopPaths = getRepoDesktopPaths(repoDir);
const backendDir = desktopPaths.backendDir;
const venvDir = desktopPaths.venvDir;
const pythonPath = desktopPaths.backendPythonPath;
const uvCacheDir = path.join(repoDir, ".uv-cache");
const requirementsPath = path.join(backendDir, "requirements.txt");

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: repoDir,
    stdio: "inherit",
    env: {
      ...process.env,
      UV_CACHE_DIR: uvCacheDir,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(requirementsPath)) {
  console.error(`Missing backend requirements: ${requirementsPath}`);
  process.exit(1);
}

console.log(`Desktop backend directory: ${backendDir}`);

if (!existsSync(venvDir)) {
  console.log("Creating backend virtualenv with uv...");
  run("uv", ["venv", venvDir]);
} else {
  console.log(`Using existing backend virtualenv: ${venvDir}`);
}

if (!existsSync(pythonPath)) {
  console.error(`Backend python not found at ${pythonPath}`);
  process.exit(1);
}

console.log("Installing backend Python dependencies...");
run("uv", ["pip", "install", "--python", pythonPath, "-r", requirementsPath]);

console.log(`Backend ready: ${pythonPath}`);
