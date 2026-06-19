#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "shared", ".drodo-build");
const source = path.join(repoRoot, "shared", "drodo-core.ts");
const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

fs.rmSync(outDir, { recursive: true, force: true });

childProcess.execFileSync(
  process.execPath,
  [
    tsc,
    source,
    "--pretty",
    "false",
    "--target",
    "ES2022",
    "--module",
    "ES2022",
    "--moduleResolution",
    "Bundler",
    "--declaration",
    "true",
    "--removeComments",
    "true",
    "--noEmitOnError",
    "true",
    "--noImplicitAny",
    "true",
    "--skipLibCheck",
    "true",
    "--outDir",
    outDir,
    "--rootDir",
    path.join(repoRoot, "shared"),
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

const generatedBanner = "// Generated from shared/drodo-core.ts. Do not edit by hand.\n";
fs.writeFileSync(
  path.join(repoRoot, "shared", "drodo-core.mjs"),
  `${generatedBanner}${fs.readFileSync(path.join(outDir, "drodo-core.js"), "utf8")}`,
  "utf8",
);
fs.writeFileSync(
  path.join(repoRoot, "shared", "drodo-core.d.mts"),
  `${generatedBanner}${fs.readFileSync(path.join(outDir, "drodo-core.d.ts"), "utf8")}`,
  "utf8",
);
fs.rmSync(outDir, { recursive: true, force: true });
