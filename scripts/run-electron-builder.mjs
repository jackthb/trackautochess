import path from "node:path";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(__dirname, "..");
const toolsBinDir = path.join(repoDir, "tools", "bin");
const appNodeModulesDir = path.join(repoDir, "app", "node_modules");
const spawnPatch = path.join(__dirname, "electron-builder-spawn-fix.cjs");
const cacheRoot = path.join(repoDir, ".electron-builder-cache");
if (!existsSync(appNodeModulesDir)) {
  console.error(
    "Missing app dependencies. Run `pnpm --dir app install` (or `npm run install:desktop:app`) before building the installer.",
  );
  process.exit(1);
}

const runtimeDependencies = [
  "electron-updater",
  "builder-util-runtime",
  "argparse",
  "debug",
  "fs-extra",
  "graceful-fs",
  "js-yaml",
  "jsonfile",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "ms",
  "sax",
  "semver",
  "tiny-typed-emitter",
  "universalify",
];

function ensureRuntimeDependencyCopies() {
  const rootNodeModulesDir = path.join(repoDir, "node_modules");
  mkdirSync(appNodeModulesDir, { recursive: true });

  for (const name of runtimeDependencies) {
    const source = path.join(rootNodeModulesDir, name);
    const target = path.join(appNodeModulesDir, name);
    if (!existsSync(source)) continue;
    if (existsSync(target)) {
      try {
        if (lstatSync(target).isSymbolicLink()) {
          rmSync(target, { recursive: true, force: true });
        }
      } catch {
        continue;
      }
    }

    try {
      cpSync(source, target, { recursive: true, dereference: true, force: true });
    } catch (error) {
      console.warn(`Unable to copy runtime dependency ${name}: ${error.message}`);
    }
  }
}

ensureRuntimeDependencyCopies();
const args = process.argv.slice(2);
const signingConfigured = Boolean(
  process.env.WIN_CSC_LINK ||
    process.env.CSC_LINK ||
    process.env.WIN_CSC_SHA1 ||
    process.env.WIN_CSC_AUTO === "1"
);
const effectiveArgs = signingConfigured
  ? args
  : [...args, "--config.win.signAndEditExecutable=false"];

function resolveElectronBuilderCli() {
  const require = createRequire(import.meta.url);
  let electronBuilderPackageJson;

  try {
    electronBuilderPackageJson = require.resolve("electron-builder/package.json", {
      paths: [appNodeModulesDir],
    });
  } catch {
    return null;
  }

  try {
    const pkg = JSON.parse(readFileSync(electronBuilderPackageJson, "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["electron-builder"];

    if (typeof bin === "string") {
      const fromPackageJson = path.join(path.dirname(electronBuilderPackageJson), bin);
      if (existsSync(fromPackageJson)) {
        return fromPackageJson;
      }
    }
  } catch {
    // Fall through to fallback probing.
  }

  const candidates = [
    "electron-builder/cli.js",
    "electron-builder/cli",
    "electron-builder/bin/cli.js",
    "electron-builder/bin/electron-builder.js",
    "electron-builder/out/cli.js",
    "electron-builder/out/cli/cli.js",
  ];

  for (const candidate of candidates) {
    try {
      const candidatePath = require.resolve(candidate, { paths: [appNodeModulesDir] });
      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

const electronBuilderCli = resolveElectronBuilderCli();
if (!electronBuilderCli) {
  console.error(
    "Unable to resolve the Electron Builder CLI. Run `pnpm --dir app install` first.",
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    "--require",
    spawnPatch,
    electronBuilderCli,
    ...effectiveArgs,
    "--config",
    "electron-builder.json",
  ],
  {
    cwd: path.join(repoDir, "app"),
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_BUILDER_CACHE: path.join(cacheRoot, "electron-builder"),
      PATH: `${toolsBinDir}${path.delimiter}${process.env.PATH || ""}`,
      XDG_CACHE_HOME: cacheRoot,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
