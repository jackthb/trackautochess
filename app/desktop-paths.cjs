const path = require("path");

function getVenvPythonPath(venvDir, platform = process.platform) {
  return platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function getBackendExecutableName(platform = process.platform) {
  return platform === "win32" ? "headless.exe" : "headless";
}

function getIconFilename(platform = process.platform) {
  return platform === "win32" ? "dac_tracker.ico" : "dac_tracker.png";
}

function getRepoDesktopPaths(repoDir, options = {}) {
  const platform = options.platform || process.platform;
  const defaultDacDir = options.defaultDacDir || path.join(repoDir, ".dac-local");
  const dacDir = options.dacDir || process.env.DAC_DIR || defaultDacDir;
  const appDir = path.join(repoDir, "app");
  const backendDir = path.join(appDir, "backend");
  const venvDir = path.join(backendDir, ".venv");

  return {
    repoDir,
    appDir,
    backendDir,
    venvDir,
    backendPythonPath: getVenvPythonPath(venvDir, platform),
    dataDir: path.join(repoDir, "data"),
    contentDir: path.join(repoDir, "content"),
    iconsDir: path.join(repoDir, "data", "icons"),
    dacDir,
    replayDir: path.join(dacDir, "replays"),
    screenshotDir: path.join(dacDir, "screenshots"),
    screenshotManifest: path.join(dacDir, "screenshots", "manifest.json"),
    iconFilename: getIconFilename(platform),
    backendExecutableName: getBackendExecutableName(platform),
  };
}

function getElectronDesktopPaths(appDir, options = {}) {
  const platform = options.platform || process.platform;
  const repoDir = path.resolve(appDir, "..");
  const base = getRepoDesktopPaths(repoDir, options);
  const isPackaged = Boolean(options.isPackaged);
  const resourcesDir = options.resourcesDir || repoDir;
  const trackerDir = isPackaged ? path.join(resourcesDir, "headless") : base.backendDir;
  const iconsDir = isPackaged ? path.join(resourcesDir, "data", "icons") : base.iconsDir;
  const backendCommand = isPackaged
    ? {
        command: path.join(trackerDir, base.backendExecutableName),
        args: [],
        cwd: trackerDir,
      }
    : {
        command: base.backendPythonPath,
        args: [path.join(trackerDir, "headless.py")],
        cwd: trackerDir,
      };

  return {
    ...base,
    trackerDir,
    iconsDir,
    backendCommand,
  };
}

module.exports = {
  getBackendExecutableName,
  getElectronDesktopPaths,
  getIconFilename,
  getRepoDesktopPaths,
  getVenvPythonPath,
};
