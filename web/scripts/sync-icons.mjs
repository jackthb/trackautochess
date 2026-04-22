import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, "..");
const sourceDir = path.resolve(webDir, "..", "data", "icons");
const targetDir = path.resolve(webDir, "public", "icons");

if (!existsSync(sourceDir)) {
  throw new Error(`Icons source directory not found: ${sourceDir}`);
}

mkdirSync(path.dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, { recursive: true });
