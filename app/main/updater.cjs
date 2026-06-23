const UPDATE_CHECK_INTERVAL_MS = 6 * 3600 * 1000;

function createUpdater({ app, isPackaged, emitEvent }) {
  let autoUpdater = null;
  let updateDownloaded = false;
  let latestVersion = "";

  function emit(payload) {
    emitEvent(payload);
  }

  function getUpdater() {
    if (!isPackaged) return null;
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

    autoUpdater.on("error", (error) => {
      emit({
        type: "update_error",
        backend: "electron",
        message: error?.message || String(error),
      });
    });

    return autoUpdater;
  }

  async function checkForUpdate() {
    const updater = getUpdater();
    if (!updater) return;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      console.error("Update check failed:", error);
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
    if (!isPackaged) return;
    setTimeout(checkForUpdate, 10_000);
    setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  }

  return { start, checkForUpdate, installUpdate };
}

module.exports = {
  createUpdater,
};
