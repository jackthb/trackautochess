const fs = require("fs");
const path = require("path");

const UPDATE_CHECK_INTERVAL_MS = 6 * 3600 * 1000;
const MAX_UPDATE_ERROR_MESSAGE_LENGTH = 140;

function findUpdateConfigPath() {
  const candidates = [
    path.join(process.resourcesPath, "app-update.yml"),
    path.join(process.resourcesPath, "app-update.yaml"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function isBenignUpdateError(error) {
  const rawMessage = error?.message || String(error || "");
  const compactMessage = rawMessage.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  if (!compactMessage) return false;

  return (
    /enoent|no such file or directory/.test(compactMessage) ||
    /app-update\.ya?ml/.test(compactMessage) ||
    /release[\\/]+win-unpacked/.test(compactMessage)
  );
}

function formatUpdateError(error) {
  const rawMessage = error?.message || String(error || "");
  const compactMessage = rawMessage.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  if (!compactMessage) {
    return "Update check failed.";
  }

  if (isBenignUpdateError(error)) {
    return null;
  }

  if (/\b404\b|not found|releases\.atom/i.test(compactMessage)) {
    return "Could not check for updates (release feed returned 404).";
  }

  if (/authentication token|security reasons.*actual status/i.test(compactMessage)) {
    return "Could not check for updates (release feed authentication failed).";
  }

  const withoutHeaders = compactMessage
    .replace(/\bHeaders\s*:\s*\{.*$/i, "")
    .replace(/\b(set-cookie|authorization|cookie)\b.*$/i, "")
    .trim();
  const safeMessage = withoutHeaders || "Update check failed.";

  if (safeMessage.length <= MAX_UPDATE_ERROR_MESSAGE_LENGTH) {
    return safeMessage;
  }

  return `${safeMessage.slice(0, MAX_UPDATE_ERROR_MESSAGE_LENGTH - 3)}...`;
}

function createUpdater({ isPackaged, emitEvent }) {
  let autoUpdater = null;
  let updateDownloaded = false;
  let latestVersion = "";
  let updaterEnabled = null;

  function emit(payload) {
    emitEvent(payload);
  }

  function isUpdaterEnabled() {
    if (updaterEnabled !== null) return updaterEnabled;
    if (!isPackaged) {
      updaterEnabled = false;
      return false;
    }
    if (process.env.DAC_DISABLE_UPDATES === "1") {
      updaterEnabled = false;
      return false;
    }
    updaterEnabled = Boolean(findUpdateConfigPath());
    return updaterEnabled;
  }

  function emitUpdateError(error) {
    if (isBenignUpdateError(error)) {
      console.info(
        "Auto-updater skipped:",
        error?.message || String(error || "missing update metadata"),
      );
      return;
    }

    const message = formatUpdateError(error);
    if (!message) return;

    console.warn(`Update check failed: ${message}`);
    emit({
      type: "update_error",
      backend: "electron",
      message,
    });
  }

  function getUpdater() {
    if (!isUpdaterEnabled()) return null;
    if (autoUpdater) return autoUpdater;

    try {
      ({ autoUpdater } = require("electron-updater"));
    } catch (error) {
      console.error("Failed to load electron-updater:", error);
      return null;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = console;

    autoUpdater.on("checking-for-update", () => {
      emit({ type: "update_checking", backend: "electron" });
    });

    autoUpdater.on("update-available", (info) => {
      latestVersion = info?.version || "";
      updateDownloaded = false;
      emit({
        type: "update_available",
        backend: "electron",
        tag: latestVersion ? `v${latestVersion}` : "",
        version: latestVersion,
      });
    });

    autoUpdater.on("update-not-available", () => {
      emit({ type: "update_not_available", backend: "electron" });
    });

    autoUpdater.on("download-progress", (progress) => {
      emit({
        type: "update_download_progress",
        backend: "electron",
        version: latestVersion,
        percent: Math.max(0, Math.min(100, progress?.percent || 0)),
        transferred: progress?.transferred || 0,
        total: progress?.total || 0,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      latestVersion = info?.version || latestVersion;
      updateDownloaded = true;
      emit({
        type: "update_downloaded",
        backend: "electron",
        tag: latestVersion ? `v${latestVersion}` : "",
        version: latestVersion,
      });
    });

    autoUpdater.on("error", emitUpdateError);

    return autoUpdater;
  }

  async function checkForUpdate() {
    const updater = getUpdater();
    if (!updater) return;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      emitUpdateError(error);
    }
  }

  function installUpdate() {
    const updater = getUpdater();
    if (!updater) {
      emit({ type: "error", message: "Auto updater is unavailable." });
      return false;
    }
    if (!updateDownloaded) {
      emit({ type: "error", message: "No downloaded update is ready to install." });
      return false;
    }
    emit({ type: "update_apply_requested", backend: "electron", ok: true });
    setImmediate(() => updater.quitAndInstall(false, true));
    return true;
  }

  function start() {
    if (!isUpdaterEnabled()) {
      if (isPackaged) {
        console.info(
          "Auto-updater disabled: this build has no app-update.yml (expected for local win-unpacked builds).",
        );
      }
      return;
    }
    setTimeout(checkForUpdate, 10_000);
    setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  }

  return { start, checkForUpdate, installUpdate };
}

module.exports = {
  createUpdater,
};
