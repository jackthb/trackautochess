import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const source = resolve(repoRoot, "data", "icons");
const destination = resolve(webRoot, "public", "icons");

export function syncIcons() {
  if (!existsSync(source)) {
    console.warn(`[sync-icons] Missing source directory: ${source}`);
    return;
  }

  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

syncIcons();
