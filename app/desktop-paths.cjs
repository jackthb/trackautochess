const path = require("path");

function getRustBackendExecutableName(platform = process.platform) {
  return platform === "win32" ? "dac-capture-backend.exe" : "dac-capture-backend";
}

function getIconFilename(platform = process.platform) {
  return platform === "win32" ? "dac_tracker.ico" : "dac_tracker.png";
}

function getRepoDesktopPaths(repoDir, options = {}) {
  const platform = options.platform || process.platform;
  const defaultDacDir = options.defaultDacDir || path.join(repoDir, ".dac-local");
  const dacDir = options.dacDir || process.env.DAC_DIR || defaultDacDir;
  const appDir = path.join(repoDir, "app");
  const rustBackendDir = path.join(appDir, "backend");

  return {
    repoDir,
    appDir,
    rustBackendDir,
    backendKind: "rust",
    dataDir: path.join(repoDir, "data"),
    contentDir: path.join(repoDir, "content"),
    iconsDir: path.join(repoDir, "data", "icons"),
    dacDir,
    replayDir: path.join(dacDir, "replays"),
    iconFilename: getIconFilename(platform),
    backendExecutableName: getRustBackendExecutableName(platform),
    rustBackendExecutableName: getRustBackendExecutableName(platform),
  };
}

function getElectronDesktopPaths(appDir, options = {}) {
  const platform = options.platform || process.platform;
  const repoDir = path.resolve(appDir, "..");
  const base = getRepoDesktopPaths(repoDir, options);
  const isPackaged = Boolean(options.isPackaged);
  const resourcesDir = options.resourcesDir || repoDir;
  const iconsDir = isPackaged ? path.join(resourcesDir, "data", "icons") : base.iconsDir;
  const trackerDir = isPackaged
    ? path.join(resourcesDir, "headless")
    : base.rustBackendDir;
  const backendCommand = isPackaged
    ? {
        command: path.join(trackerDir, base.backendExecutableName),
        args: [],
        cwd: trackerDir,
      }
    : {
        command: process.env.CARGO || "cargo",
        args: ["run", "--manifest-path", path.join(base.rustBackendDir, "Cargo.toml"), "--", "daemon"],
        cwd: repoDir,
      };

  return {
    ...base,
    trackerDir,
    iconsDir,
    backendCommand,
  };
}

module.exports = {
  getBackendExecutableName: getRustBackendExecutableName,
  getRustBackendExecutableName,
  getElectronDesktopPaths,
  getIconFilename,
  getRepoDesktopPaths,
};
