const childProcess = require("node:child_process");
const path = require("node:path");

const originalSpawn = childProcess.spawn;
const patchedCommands = new Set(["bun", "npm", "pnpm", "yarn"]);
const appNodeModulesDir = path.join(__dirname, "..", "app", "node_modules");

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

childProcess.spawn = function patchedSpawn(command, args, options) {
  const base = typeof command === "string" ? path.basename(command) : "";
  if (
    process.platform !== "win32" &&
    options &&
    options.shell === true &&
    patchedCommands.has(base) &&
    Array.isArray(args)
  ) {
    const commandLine = [command, ...args].map(shellQuote).join(" ");
    return originalSpawn("/bin/sh", ["-lc", commandLine], {
      ...options,
      shell: false,
    });
  }

  return originalSpawn(command, args, options);
};

try {
  const electronBuilderPackage = require.resolve("electron-builder/package.json", {
    paths: [appNodeModulesDir],
  });
  const pnpmCollectorModule = path.join(
    path.dirname(path.dirname(electronBuilderPackage)),
    "app-builder-lib",
    "out",
    "node-module-collector",
    "pnpmNodeModulesCollector.js",
  );
  const { PnpmNodeModulesCollector } = require(pnpmCollectorModule);

  if (!PnpmNodeModulesCollector.prototype.__dacPatched) {
    const originalGetNodeModules = PnpmNodeModulesCollector.prototype.getNodeModules;
    PnpmNodeModulesCollector.prototype.getNodeModules = async function patchedGetNodeModules(...args) {
      try {
        return await originalGetNodeModules.apply(this, args);
      } catch (error) {
        const message = error && typeof error.message === "string" ? error.message : "";
        if (!message.includes("No JSON content found in output")) {
          throw error;
        }
        return {
          nodeModules: [],
          logSummary: this.cache?.logSummary ?? {},
        };
      }
    };
    PnpmNodeModulesCollector.prototype.__dacPatched = true;
  }
} catch {
  // If electron-builder or app-builder-lib is unavailable, leave the default behavior in place.
}
