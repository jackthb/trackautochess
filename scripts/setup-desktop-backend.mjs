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

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (desktopPaths.backendKind === "rust") {
  console.log(`Building Rust desktop backend: ${desktopPaths.rustBackendDir}`);
  run("cargo", ["build", "--manifest-path", path.join(desktopPaths.rustBackendDir, "Cargo.toml")]);
  console.log("Rust desktop backend ready.");
  process.exit(0);
}

const backendDir = desktopPaths.backendDir;
const venvDir = desktopPaths.venvDir;
const pythonPath = desktopPaths.backendPythonPath;
const uvCacheDir = path.join(repoDir, ".uv-cache");
const requirementsPath = path.join(backendDir, "requirements.txt");

if (!existsSync(requirementsPath)) {
  console.error(`Missing backend requirements: ${requirementsPath}`);
  process.exit(1);
}

console.log(`Desktop Python backend directory: ${backendDir}`);

if (!existsSync(venvDir)) {
  console.log("Creating backend virtualenv with uv...");
  run("uv", ["venv", venvDir], { UV_CACHE_DIR: uvCacheDir });
} else {
  console.log(`Using existing backend virtualenv: ${venvDir}`);
}

if (!existsSync(pythonPath)) {
  console.error(`Backend python not found at ${pythonPath}`);
  process.exit(1);
}

console.log("Installing backend Python dependencies...");
run("uv", ["pip", "install", "--python", pythonPath, "-r", requirementsPath], { UV_CACHE_DIR: uvCacheDir });

console.log(`Python backend ready: ${pythonPath}`);
