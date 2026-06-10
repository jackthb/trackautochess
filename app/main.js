const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  Menu,
  nativeImage,
  globalShortcut,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const { spawn, execFile } = require("child_process");
const readline = require("readline");
const { getElectronDesktopPaths } = require("./desktop-paths.cjs");
const { CHANNELS } = require("./ipc-channels.cjs");
const { createBackendSupervisor } = require("./main/backend-supervisor.cjs");
const { createContentIpc } = require("./main/content.cjs");
const { createReplays } = require("./main/replays.cjs");
const { createTrackerLog } = require("./main/tracker-log.cjs");
const { createUpdater } = require("./main/updater.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "replay",
    privileges: {
      standard: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
  {
    scheme: "icons",
    privileges: {
      standard: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

const IS_PACKAGED = app.isPackaged;
const RESOURCES_DIR = IS_PACKAGED ? process.resourcesPath : path.join(__dirname, "..");
const DESKTOP_PATHS = getElectronDesktopPaths(__dirname, {
  dacDir: process.env.DAC_DIR,
  defaultDacDir: path.join(os.homedir(), ".dac"),
  isPackaged: IS_PACKAGED,
  resourcesDir: RESOURCES_DIR,
});
const DAC_DIR = DESKTOP_PATHS.dacDir;
const REPLAY_DIR = DESKTOP_PATHS.replayDir;
const ICONS_DIR = DESKTOP_PATHS.iconsDir;
const ICON_FILENAME = DESKTOP_PATHS.iconFilename;
const CONTENT_DIR = path.join(RESOURCES_DIR, "content");
const IS_DEV = !IS_PACKAGED && process.argv.includes("--dev");
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

for (const dir of [DAC_DIR, REPLAY_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let mainWindow = null;
let dotaPollInterval = null;
let dotaOpen = false;
let isQuitting = false;
let trackerStatus = {
  recording: false,
  focused: false,
  logged_in: false,
  version: "",
  steam_id: "",
  steam_name: "",
  replay_enabled: true,
};

function getMainWindow() {
  return mainWindow;
}

const trackerLog = createTrackerLog({
  ipcMain,
  fs,
  path,
  appUserDataDir: app.getPath("userData"),
  getMainWindow,
  channels: CHANNELS,
});
const backend = createBackendSupervisor({
  fs,
  path,
  spawn,
  readline,
  desktopPaths: DESKTOP_PATHS,
  isDev: IS_DEV,
  env: process.env,
  trackerLogPath: trackerLog.trackerLogPath,
  appendLog: trackerLog.append,
});
const updater = createUpdater({
  app,
  https,
  isPackaged: IS_PACKAGED,
  getTrackerStatus: () => trackerStatus,
  emitEvent: handleBackendEvent,
});
const content = createContentIpc({ ipcMain, fs, path, contentDir: CONTENT_DIR, channels: CHANNELS });
const replays = createReplays({
  ipcMain,
  protocol,
  net,
  shell,
  fs,
  path,
  replayDir: REPLAY_DIR,
  iconsDir: ICONS_DIR,
  channels: CHANNELS,
});

backend.onEvent(handleBackendEvent);
trackerLog.registerIpc();
content.register();
replays.registerIpc();

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function handleBackendEvent(msg) {
  trackerLog.logBackendEvent(msg);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.tracker.event, msg);
  }

  switch (msg.type) {
    case "status":
      trackerStatus = { ...trackerStatus, ...msg };
      break;
    case "steam_login":
      trackerStatus.logged_in = true;
      trackerStatus.steam_id = msg.steam_id;
      trackerStatus.steam_name = msg.steam_name;
      break;
    case "steam_login_url":
      if (msg.url) {
        shell.openExternal(msg.url).catch((err) => {
          console.error("Failed to open Steam login URL:", err);
        });
      }
      break;
    case "replay_started":
      trackerStatus.recording = true;
      break;
    case "replay_saved":
      trackerStatus.recording = false;
      break;
    case "focus_gained":
      trackerStatus.focused = true;
      break;
    case "focus_lost":
      trackerStatus.focused = false;
      break;
    case "update_available":
      trackerStatus.update = {
        tag: msg.tag,
        downloadUrl: msg.download_url,
        htmlUrl: msg.html_url,
      };
      break;
  }
}

function startDotaPoller() {
  function checkDota() {
    execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq dota2.exe", "/NH", "/FO", "CSV"],
      { windowsHide: true },
      (err, stdout) => {
        const isOpen = !err && stdout.toLowerCase().includes("dota2.exe");
        if (isOpen !== dotaOpen) dotaOpen = isOpen;
      },
    );
  }

  checkDota();
  dotaPollInterval = setInterval(checkDota, 3000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#1e2130",
    icon: path.join(ICONS_DIR, ICON_FILENAME),
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (IS_DEV) {
    mainWindow
      .loadURL("http://localhost:5173")
      .catch(() => mainWindow.loadFile(path.join(__dirname, "dist", "index.html")));
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("close", () => {
    isQuitting = true;
    app.quit();
  });
}

function registerShortcuts() {
  globalShortcut.register("F6", () => {
    backend.send({ cmd: "capture" });
  });
  globalShortcut.register("F7", () => {
    backend.send({ cmd: "toggle_recording" });
  });
}

ipcMain.on(CHANNELS.window.minimize, () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on(CHANNELS.window.maximize, () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on(CHANNELS.window.close, () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.on(CHANNELS.tracker.command, (_event, cmd) => {
  if (cmd?.cmd === "do_update") {
    const url = cmd.download_url || cmd.downloadUrl || trackerStatus.update?.downloadUrl || trackerStatus.update?.htmlUrl;
    if (url) {
      shell.openExternal(url);
      handleBackendEvent({ type: "update_apply_requested", backend: "electron", ok: true });
    } else {
      handleBackendEvent({ type: "error", message: "No update URL is available." });
    }
    return;
  }
  backend.send(cmd);
});

ipcMain.handle(CHANNELS.app.openExternal, async (_event, url) => {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle(CHANNELS.app.getVersion, () => app.getVersion());

app.on("second-instance", () => {
  if (app.isReady()) {
    focusMainWindow();
  } else {
    app.whenReady().then(() => setTimeout(focusMainWindow, 0));
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  replays.registerProtocols();
  Menu.setApplicationMenu(null);
  createWindow();

  startDotaPoller();
  registerShortcuts();
  backend.start();
  backend.startDevWatcher();
  trackerLog.startTrackerWatcher();
  trackerLog.startDotaWatcher();
  updater.start();

  app.on("activate", () => {
    focusMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  trackerLog.stop();
  backend.stop();
  if (dotaPollInterval) clearInterval(dotaPollInterval);
});

app.on("window-all-closed", () => {
  app.quit();
});
