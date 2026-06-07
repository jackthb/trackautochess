const path = require("path");

function getVenvPythonPath(venvDir, platform = process.platform) {
  return platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function getPythonBackendExecutableName(platform = process.platform) {
  return platform === "win32" ? "headless.exe" : "headless";
}

function getRustBackendExecutableName(platform = process.platform) {
  return platform === "win32" ? "dac-capture-backend.exe" : "dac-capture-backend";
}

function normalizeBackendKind(kind) {
  const normalized = String(kind || "rust").trim().toLowerCase();
  return normalized === "python" ? "python" : "rust";
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
  const rustBackendDir = path.join(appDir, "backend-rs");
  const venvDir = path.join(backendDir, ".venv");
  const backendKind = normalizeBackendKind(options.backendKind || process.env.DAC_BACKEND);

  return {
    repoDir,
    appDir,
    backendDir,
    rustBackendDir,
    venvDir,
    backendKind,
    backendPythonPath: getVenvPythonPath(venvDir, platform),
    dataDir: path.join(repoDir, "data"),
    contentDir: path.join(repoDir, "content"),
    iconsDir: path.join(repoDir, "data", "icons"),
    dacDir,
    replayDir: path.join(dacDir, "replays"),
    screenshotDir: path.join(dacDir, "screenshots"),
    screenshotManifest: path.join(dacDir, "screenshots", "manifest.json"),
    iconFilename: getIconFilename(platform),
    backendExecutableName:
      backendKind === "python"
        ? getPythonBackendExecutableName(platform)
        : getRustBackendExecutableName(platform),
    rustBackendExecutableName: getRustBackendExecutableName(platform),
    pythonBackendExecutableName: getPythonBackendExecutableName(platform),
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
    : base.backendKind === "python"
      ? base.backendDir
      : base.rustBackendDir;
  const backendCommand = isPackaged
    ? {
        command: path.join(trackerDir, base.backendExecutableName),
        args: [],
        cwd: trackerDir,
      }
    : base.backendKind === "python"
      ? {
          command: base.backendPythonPath,
          args: [path.join(trackerDir, "headless.py")],
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
  getPythonBackendExecutableName,
  getRustBackendExecutableName,
  getElectronDesktopPaths,
  getIconFilename,
  getRepoDesktopPaths,
  getVenvPythonPath,
  normalizeBackendKind,
};
