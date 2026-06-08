import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(appDir, "..");
const manifest = path.join(appDir, "backend-rs", "Cargo.toml");
const targetDir = path.join(appDir, "backend-rs", "target", "release");
const distDir = path.join(appDir, "backend-rs", "dist", "headless");
const exeName = process.platform === "win32" ? "dac-capture-backend.exe" : "dac-capture-backend";
const cargoName = process.platform === "win32" ? "cargo.exe" : "cargo";
const cargoPath = process.platform === "win32" && process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, ".cargo", "bin", cargoName)
  : cargoName;

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: repoDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(manifest)) {
  console.error(`Missing Rust backend manifest: ${manifest}`);
  process.exit(1);
}

run(existsSync(cargoPath) ? cargoPath : "cargo", ["build", "--release", "--manifest-path", manifest]);

mkdirSync(distDir, { recursive: true });
copyFileSync(path.join(targetDir, exeName), path.join(distDir, exeName));
console.log(`Rust backend copied to ${path.join(distDir, exeName)}`);
