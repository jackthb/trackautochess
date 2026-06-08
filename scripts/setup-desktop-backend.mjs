import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getRepoDesktopPaths } = require("./desktop-paths.cjs");
const repoDir = path.resolve(__dirname, "..");
const desktopPaths = getRepoDesktopPaths(repoDir);

const result = spawnSync("cargo", ["build", "--manifest-path", path.join(desktopPaths.rustBackendDir, "Cargo.toml")], {
  cwd: repoDir,
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Rust desktop backend ready: ${desktopPaths.rustBackendDir}`);
