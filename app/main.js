const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
  dialog,
  screen,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const readline = require("readline");
const { getElectronDesktopPaths } = require("./desktop-paths.cjs");

const IS_PACKAGED = app.isPackaged;
const RESOURCES_DIR = IS_PACKAGED
  ? process.resourcesPath
  : path.join(__dirname, "..");
const DESKTOP_PATHS = getElectronDesktopPaths(__dirname, {
  dacDir: process.env.DAC_DIR,
  defaultDacDir: path.join(os.homedir(), ".dac"),
  isPackaged: IS_PACKAGED,
  resourcesDir: RESOURCES_DIR,
});
const DAC_DIR = DESKTOP_PATHS.dacDir;
const REPLAY_DIR = DESKTOP_PATHS.replayDir;
const SCREENSHOT_DIR = DESKTOP_PATHS.screenshotDir;
const SCREENSHOT_MANIFEST = DESKTOP_PATHS.screenshotManifest;
const TRACKER_DIR = DESKTOP_PATHS.trackerDir;
const ICONS_DIR = DESKTOP_PATHS.iconsDir;
const ICON_FILENAME = DESKTOP_PATHS.iconFilename;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

// Ensure dirs exist
for (const dir of [DAC_DIR, REPLAY_DIR, SCREENSHOT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let mainWindow = null;
// let overlayWindow = null;
let widgetWindow = null;
let notificationWindow = null;
let tray = null;
let pythonProcess = null;
let pythonRL = null;
const labResolvers = new Map();
let nextLabReqId = 1;
function nextReqId() { return `lab-${nextLabReqId++}-${Date.now()}`; }
// let overlayTimeout = null;
let dotaPollInterval = null;
let dotaOpen = false;
let notificationReady = false;
let nextNotificationId = 1;
let closeToTray = true; // default: minimize to tray on close
let isQuitting = false; // true when quitting from tray or app.quit()
const notificationItems = [];
const notificationTimers = new Map();
let trackerStatus = {
  recording: false,
  focused: false,
  logged_in: false,
  version: "",
  steam_id: "",
  steam_name: "",
  replay_enabled: true,
};

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

const NOTIFICATION_WINDOW_WIDTH = 340;
const NOTIFICATION_WINDOW_MARGIN = 20;
const NOTIFICATION_WINDOW_TOP = 76;
const NOTIFICATION_CARD_HEIGHT = 96;
const NOTIFICATION_CARD_GAP = 10;
const NOTIFICATION_WINDOW_PADDING = 8;
const MAX_VISIBLE_NOTIFICATIONS = 4;
const SUPPRESSED_NOTIFICATION_PATTERNS = [
  /^Recording started$/i,
  /^Game started.*recording replay$/i,
  /^Game ended! Open Match History and click Capture\.$/i,
  /^My Matches detected.*parsing/i,
  /^Game Over detected.*parsing all players/i,
  /^Logged out of Steam\.$/i,
];

// ── Python subprocess ────────────────────────────────────────────────────────

function getBackendCommand() {
  return DESKTOP_PATHS.backendCommand;
}

function startPython() {
  const { command, args, cwd } = getBackendCommand();

  if (!fs.existsSync(command)) {
    console.error(`Backend not found at ${command}`);
    return;
  }

  console.log(`Starting backend: ${command} ${args.join(" ")}`);

  pythonProcess = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Read stdout line by line (JSON lines protocol)
  pythonRL = readline.createInterface({ input: pythonProcess.stdout });
  pythonRL.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      handlePythonEvent(msg);
    } catch (e) {
      console.error("Failed to parse Python output:", line);
    }
  });

  // Log stderr
  pythonProcess.stderr.on("data", (data) => {
    console.error(`[python stderr] ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`Python process exited with code ${code}`);
    pythonProcess = null;
    pythonRL = null;

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tracker:event", {
        type: "error",
        message: `Python backend exited (code ${code})`,
      });
    }
  });

  pythonProcess.on("error", (err) => {
    console.error("Failed to start Python:", err);
  });
}

function sendToPython(cmd) {
  if (!pythonProcess || !pythonProcess.stdin.writable) {
    console.error("Python process not running — cannot send:", cmd);
    return;
  }
  const line = JSON.stringify(cmd) + "\n";
  console.log("sendToPython:", line.trim());
  pythonProcess.stdin.write(line);
}

// ── Close-to-tray config ────────────────────────────────────────────────────

function loadCloseToTray() {
  const configPath = path.join(DAC_DIR, "config.json");
  if (!fs.existsSync(configPath)) return true;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.close_to_tray !== false; // default true
  } catch {
    return true;
  }
}

function saveCloseToTray(value) {
  const configPath = path.join(DAC_DIR, "config.json");
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {}
  config.close_to_tray = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ── System tray ─────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(ICONS_DIR, ICON_FILENAME);
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    // Resize for tray: 16x16 on most platforms
    if (!icon.isEmpty()) {
      icon = icon.resize({ width: 16, height: 16 });
    }
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("DAC Tracker");

  updateTrayMenu();

  tray.on("double-click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function handlePythonEvent(msg) {
  // Forward all events to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tracker:event", msg);
  }

  // Forward status to widget
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (msg.type === "status" || msg.type === "replay_started" || msg.type === "replay_saved") {
      widgetWindow.webContents.send("widget:status", {
        recording: msg.type === "replay_started" ? true :
                   msg.type === "replay_saved" ? false :
                   msg.recording || false,
      });
    }
  }

  switch (msg.type) {
    case "status":
      trackerStatus = { ...trackerStatus, ...msg };
      break;

    // PARKED — old CV capture overlay. Nettable capture handles game-end now.
    // case "sentinel_match":
    //   showOverlay();
    //   break;

    case "notification":
      enqueueNotification(msg.title, msg.message);
      break;

    case "steam_login":
      trackerStatus.logged_in = true;
      trackerStatus.steam_id = msg.steam_id;
      trackerStatus.steam_name = msg.steam_name;
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

    case "processing_screenshot":
    case "parse_result":
      // Switch to confirmation tab
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      break;

    case "lab_parse_full_result":
    case "lab_parse_region_result": {
      const data = msg.data || {};
      const reqId = data.req_id;
      if (reqId && labResolvers.has(reqId)) {
        const resolve = labResolvers.get(reqId);
        labResolvers.delete(reqId);
        resolve(data);
      }
      break;
    }
  }
}

// ── Notifications ────────────────────────────────────────────────────────────

function shouldShowNotification(body = "") {
  return !SUPPRESSED_NOTIFICATION_PATTERNS.some((pattern) => pattern.test(body));
}

function getNotificationTone(body = "") {
  if (/failed|error|timed out|cannot import|not recognised|not recognized|no rows/i.test(body)) {
    return "error";
  }
  if (/disabled|already imported|already in progress|not on my matches|skipping/i.test(body)) {
    return "warning";
  }
  if (/saved|imported/i.test(body)) {
    return "success";
  }
  return "info";
}

function getNotificationTimeoutMs(tone) {
  switch (tone) {
    case "error":
      return 7000;
    case "warning":
      return 6000;
    case "success":
      return 5000;
    default:
      return 4500;
  }
}

function getNotificationWindowBounds(count) {
  const display = screen.getPrimaryDisplay().workArea;
  const height = Math.max(
    1,
    NOTIFICATION_WINDOW_PADDING * 2 +
      count * NOTIFICATION_CARD_HEIGHT +
      Math.max(0, count - 1) * NOTIFICATION_CARD_GAP
  );

  return {
    width: NOTIFICATION_WINDOW_WIDTH,
    height,
    x: display.x + display.width - NOTIFICATION_WINDOW_WIDTH - NOTIFICATION_WINDOW_MARGIN,
    y: display.y + NOTIFICATION_WINDOW_TOP,
  };
}

function syncNotificationWindow() {
  if (!notificationWindow || notificationWindow.isDestroyed()) {
    return;
  }

  if (!notificationItems.length) {
    notificationWindow.hide();
    return;
  }

  const visibleItems = notificationItems.slice(-MAX_VISIBLE_NOTIFICATIONS).reverse();
  notificationWindow.setBounds(getNotificationWindowBounds(visibleItems.length), false);

  if (!notificationReady) {
    return;
  }

  notificationWindow.webContents.send("notification:update", visibleItems);
  notificationWindow.showInactive();
}

function removeNotification(id) {
  const timer = notificationTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    notificationTimers.delete(id);
  }

  const index = notificationItems.findIndex((item) => item.id === id);
  if (index !== -1) {
    notificationItems.splice(index, 1);
    syncNotificationWindow();
  }
}

function enqueueNotification(title, body) {
  if (!shouldShowNotification(body)) {
    return;
  }

  const tone = getNotificationTone(body);
  const id = `notification-${nextNotificationId++}`;
  const item = {
    id,
    title: title || "DAC Tracker",
    body,
    tone,
  };

  notificationItems.push(item);

  while (notificationItems.length > MAX_VISIBLE_NOTIFICATIONS) {
    removeNotification(notificationItems[0].id);
  }

  const timer = setTimeout(() => removeNotification(id), getNotificationTimeoutMs(tone));
  notificationTimers.set(id, timer);
  syncNotificationWindow();
}

function createNotificationWindow() {
  notificationWindow = new BrowserWindow({
    ...getNotificationWindowBounds(1),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-notification.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notificationWindow.loadFile(path.join(__dirname, "notification.html"));
  notificationWindow.setAlwaysOnTop(true, "screen-saver");

  notificationWindow.webContents.on("did-finish-load", () => {
    notificationReady = true;
    syncNotificationWindow();
  });

  notificationWindow.on("closed", () => {
    notificationReady = false;
    notificationWindow = null;
  });
}

// ── Overlay window (PARKED — old CV capture flow) ────────────────────────────
/*
function showOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.size;

  const ICON_X = 0.087;
  const ICON_Y = 0.027;
  const iconPx = Math.round(ICON_X * screenW);
  const iconPy = Math.round(ICON_Y * screenH);
  const winW = 310;
  const winH = 120;
  const x = iconPx + 20;
  const y = Math.max(0, iconPy - Math.round(winH / 2));

  overlayWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
  overlayWindow.setAlwaysOnTop(true, "screen-saver");

  if (overlayTimeout) clearTimeout(overlayTimeout);
  overlayTimeout = setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
      overlayWindow = null;
    }
  }, 120000);

  overlayWindow.on("closed", () => {
    overlayWindow = null;
    if (overlayTimeout) {
      clearTimeout(overlayTimeout);
      overlayTimeout = null;
    }
  });
}

function dismissOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

ipcMain.on("overlay:capture", () => {
  dismissOverlay();
  sendToPython({ cmd: "capture" });
});

ipcMain.on("overlay:dismiss", () => {
  dismissOverlay();
});
*/

// ── Dota 2 process detection ─────────────────────────────────────────────────

function startDotaPoller() {
  const { execFile } = require("child_process");

  function checkDota() {
    // tasklist is fast with /FI filter — only matches dota2.exe
    execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq dota2.exe", "/NH", "/FO", "CSV"],
      { windowsHide: true },
      (err, stdout) => {
        const isOpen = !err && stdout.toLowerCase().includes("dota2.exe");
        if (isOpen !== dotaOpen) {
          dotaOpen = isOpen;
          if (widgetWindow && !widgetWindow.isDestroyed()) {
            if (dotaOpen) {
              widgetWindow.show();
            } else {
              widgetWindow.hide();
            }
          }
        }
      }
    );
  }

  checkDota();
  dotaPollInterval = setInterval(checkDota, 3000);
}

// ── Widget window (Discord-style floating controls) ─────────────────────────

function createWidget() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW } = primaryDisplay.size;

  widgetWindow = new BrowserWindow({
    width: 120,
    height: 44,
    x: screenW - 140,
    y: 20,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-widget.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  widgetWindow.loadFile(path.join(__dirname, "widget.html"));
  widgetWindow.setAlwaysOnTop(true, "screen-saver");

  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
}

ipcMain.on("widget:toggle-recording", () => {
  sendToPython({ cmd: "toggle_recording" });
});

ipcMain.on("widget:capture", () => {
  sendToPython({ cmd: "capture" });
});

ipcMain.on("notification:dismiss", (_event, id) => {
  removeNotification(id);
});

// ── Main window ──────────────────────────────────────────────────────────────

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

  const isDev = process.argv.includes("--dev");

  if (isDev) {
    // Try Vite dev server first, fall back to dist build
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

  // Intercept close: minimize to tray instead of quitting
  mainWindow.on("close", (e) => {
    if (!isQuitting && closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Global shortcuts ─────────────────────────────────────────────────────────

function registerShortcuts() {
  globalShortcut.register("F6", () => {
    sendToPython({ cmd: "capture" });
  });
  globalShortcut.register("F7", () => {
    sendToPython({ cmd: "toggle_recording" });
  });
}

// ── Window controls IPC ──────────────────────────────────────────────────

ipcMain.on("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on("window:maximize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// ── Close-to-tray IPC ──────────────────────────────────────────────────────

ipcMain.handle("app:getCloseToTray", () => closeToTray);

ipcMain.handle("app:setCloseToTray", (_event, value) => {
  closeToTray = !!value;
  saveCloseToTray(closeToTray);
  return closeToTray;
});

// ── Tracker IPC (renderer → main → Python) ──────────────────────────────────

ipcMain.on("tracker:command", (_event, cmd) => {
  sendToPython(cmd);
});

// ── tracker.log file watcher (bypasses Python→Electron→React IPC) ──────────
//
// LogTab reads tracker.log directly so it shows every log line independent
// of any IPC quirks between the Python subprocess and the renderer.

const TRACKER_LOG_PATH = path.join(DAC_DIR, "tracker.log");
const DOTA_CONSOLE_LOG_CANDIDATES = [
  "C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
  "C:/Program Files/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
];
const TRACKER_LOG_INITIAL_TAIL_BYTES = 256 * 1024; // ~2.5k lines
const DOTA_LOG_INITIAL_TAIL_BYTES = 128 * 1024;
// console.log is full of [GCClient] heartbeats etc. Drop the highest-volume
// noise so the Log tab stays readable — keep everything else, especially
// our DAC_* markers and [stringtables] / DOTA_GAMERULES_STATE_* lines.
const DOTA_NOISE_RE = /\[GCClient\]|^WriteSteamRemoteStorageFileAsync|^CAsyncWriteInProgress|^\[SteamNetSockets\]/;
let trackerLogWatcher = null;
let trackerLogOffset = 0;
let dotaLogWatcher = null;
let dotaLogOffset = 0;
let dotaLogPath = null;

function parseTrackerLogLines(text) {
  const entries = [];
  const lineRegex = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue;
    const m = raw.match(lineRegex);
    if (m) {
      const ts = new Date(`${m[1]}T${m[2]}`).getTime() / 1000;
      entries.push({ type: "log", source: "tracker", ts, level: m[3], msg: m[4] });
    } else if (entries.length > 0) {
      entries[entries.length - 1].msg += "\n" + raw;
    }
  }
  return entries;
}

function parseDotaLogLines(text) {
  const entries = [];
  // Dota writes "MM/DD HH:MM:SS message" — no year, no level.
  const lineRegex = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) (.*)$/;
  const year = new Date().getFullYear();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue;
    const m = raw.match(lineRegex);
    if (m) {
      if (DOTA_NOISE_RE.test(m[6])) continue;
      const ts = new Date(`${year}-${m[1]}-${m[2]}T${m[3]}:${m[4]}:${m[5]}`).getTime() / 1000;
      entries.push({ type: "log", source: "dota", ts, level: "INFO", msg: m[6] });
    } else if (entries.length > 0) {
      entries[entries.length - 1].msg += "\n" + raw;
    }
  }
  return entries;
}

function resolveDotaLogPath() {
  for (const p of DOTA_CONSOLE_LOG_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readFileTail(filePath, maxBytes, parser) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const stats = fs.statSync(filePath);
  const start = Math.max(0, stats.size - maxBytes);
  const length = stats.size - start;
  if (length === 0) return [];
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    return parser(buf.toString("utf-8"));
  } finally {
    fs.closeSync(fd);
  }
}

ipcMain.handle("trackerLog:read", () => {
  const tracker = readFileTail(TRACKER_LOG_PATH, TRACKER_LOG_INITIAL_TAIL_BYTES, parseTrackerLogLines);
  const dotaPath = dotaLogPath || resolveDotaLogPath();
  const dota = readFileTail(dotaPath, DOTA_LOG_INITIAL_TAIL_BYTES, parseDotaLogLines);
  // Merge chronologically — the renderer expects a single stream.
  return [...tracker, ...dota].sort((a, b) => a.ts - b.ts);
});

function tailFileWatcher({ filePath, getOffset, setOffset, parser, label }) {
  if (!fs.existsSync(filePath)) return null;
  setOffset(fs.statSync(filePath).size);
  try {
    const watcher = fs.watch(filePath, (eventType) => {
      if (eventType !== "change") return;
      try {
        const stats = fs.statSync(filePath);
        let offset = getOffset();
        if (stats.size < offset) offset = 0; // truncated/rotated
        if (stats.size === offset) return;
        const length = stats.size - offset;
        const fd = fs.openSync(filePath, "r");
        try {
          const buf = Buffer.alloc(length);
          fs.readSync(fd, buf, 0, length, offset);
          setOffset(stats.size);
          const newEntries = parser(buf.toString("utf-8"));
          if (newEntries.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("trackerLog:update", newEntries);
          }
        } finally {
          fs.closeSync(fd);
        }
      } catch (e) {
        console.error(`${label} watcher read error:`, e);
      }
    });
    console.log(`${label} watcher started on ${filePath}`);
    return watcher;
  } catch (e) {
    console.error(`${label} watcher failed to start:`, e);
    return null;
  }
}

function startTrackerLogWatcher() {
  if (trackerLogWatcher) return;
  if (!fs.existsSync(TRACKER_LOG_PATH)) {
    setTimeout(startTrackerLogWatcher, 2000);
    return;
  }
  trackerLogWatcher = tailFileWatcher({
    filePath: TRACKER_LOG_PATH,
    getOffset: () => trackerLogOffset,
    setOffset: (v) => { trackerLogOffset = v; },
    parser: parseTrackerLogLines,
    label: "trackerLog",
  });
}

function startDotaLogWatcher() {
  if (dotaLogWatcher) return;
  dotaLogPath = resolveDotaLogPath();
  if (!dotaLogPath) {
    // Dota not installed yet or path differs — re-check periodically.
    setTimeout(startDotaLogWatcher, 5000);
    return;
  }
  dotaLogWatcher = tailFileWatcher({
    filePath: dotaLogPath,
    getOffset: () => dotaLogOffset,
    setOffset: (v) => { dotaLogOffset = v; },
    parser: parseDotaLogLines,
    label: "dotaLog",
  });
}

// Steam stores Dota 2 screenshots under
// <SteamRoot>/userdata/<steam32>/760/remote/570/screenshots. Default the
// upload dialogs there when we can resolve it, since that is where the
// user's Game Over caps actually live; fall back to the local mirror.
const DOTA_APP_ID = "570";
const STEAM64_BASE = 76561197960265728n;

function readSteamPathFromRegistry() {
  if (process.platform !== "win32") return null;
  for (const root of ["HKCU\\Software\\Valve\\Steam", "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam"]) {
    try {
      const out = execFileSync("reg", ["query", root, "/v", "SteamPath"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/);
      if (m) return path.normalize(m[1].trim());
    } catch {}
    try {
      const out = execFileSync("reg", ["query", root, "/v", "InstallPath"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/InstallPath\s+REG_SZ\s+([^\r\n]+)/);
      if (m) return path.normalize(m[1].trim());
    } catch {}
  }
  return null;
}

function findSteamRoot() {
  const fromReg = readSteamPathFromRegistry();
  if (fromReg && fs.existsSync(fromReg)) return fromReg;
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"]
      : process.platform === "darwin"
        ? [path.join(os.homedir(), "Library", "Application Support", "Steam")]
        : [path.join(os.homedir(), ".steam", "steam"), path.join(os.homedir(), ".local", "share", "Steam")];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getDotaScreenshotsDir() {
  const steamRoot = findSteamRoot();
  if (!steamRoot) return null;
  const config = loadTrackerConfig();
  const steamId = config && config.steam_id;
  if (!steamId) return null;
  let steam32;
  try {
    steam32 = String(BigInt(String(steamId)) - STEAM64_BASE);
  } catch {
    return null;
  }
  const dir = path.join(steamRoot, "userdata", steam32, "760", "remote", DOTA_APP_ID, "screenshots");
  return fs.existsSync(dir) ? dir : null;
}

function screenshotDialogDefault() {
  return getDotaScreenshotsDir() || path.join(DAC_DIR, "screenshots");
}

ipcMain.handle("app:openFileDialog", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select MY MATCHES screenshot",
    defaultPath: screenshotDialogDefault(),
    filters: [
      { name: "Images", extensions: ["jpg", "jpeg", "png"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle("app:openGameOverScreenshotDialog", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Game Over screenshot",
    defaultPath: screenshotDialogDefault(),
    filters: [
      { name: "Images", extensions: ["jpg", "jpeg", "png"] },
    ],
    properties: ["openFile"],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle("app:openExternal", async (_event, url) => {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("app:getVersion", () => {
  return app.getVersion();
});

// ── Games IPC (fetch from Supabase) ──────────────────────────────────────────

function loadTrackerConfig() {
  const configPath = path.join(DAC_DIR, "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

// Hash a string to a deterministic positive 32-bit int — used to mint
// stable numeric `id`s for local match_player records (the History
// tab keys rows by numeric id, but our local data is keyed by
// match_id+steam_id strings).
function hashToInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function readLocalMatchPlayers() {
  const dir = path.join(DAC_DIR, "match_players");
  if (!fs.existsSync(dir)) return [];
  const games = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const mp = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      const winRound = Number(mp.win_round || 0);
      const loseRound = Number(mp.lose_round || 0);
      games.push({
        id: hashToInt(`${mp.match_id}__${mp.steam_id}`),
        user_id: mp.steam_id || "",
        placement: String(mp.placement ?? ""),
        rank: mp.mmr_level != null ? String(mp.mmr_level) : null,
        rank_change: "none",
        lineup: mp.chess_lineup || null,
        synergies: mp.synergies || null,
        talents: mp.talents || null,
        relic: mp.relic || null,
        level: mp.hero_level != null ? String(mp.hero_level) : null,
        wl: `${winRound}-${loseRound}`,
        wins: winRound,
        losses: loseRound,
        screenshot: null,
        replay: null,
        notes: mp.mvp_chess_name ? `MVP: ${mp.mvp_chess_name}` : null,
        match_id: mp.match_id || null,
        played_at: mp.played_at,
        created_at: mp.played_at,
        // Extra fields for the timeline view (not in standard Game type,
        // but harmless if unused).
        _local: true,
        _source: "match_players",
        _file: name,
      });
    } catch (e) {
      console.error(`games:fetch local read failed for ${name}:`, e);
    }
  }
  return games;
}

ipcMain.handle("timelines:fetch", async (_event, matchId) => {
  if (!matchId) return null;
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;
  if (!url || !key) return null;
  try {
    const resp = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/match_timelines?match_id=eq.${encodeURIComponent(matchId)}&select=timeline`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      },
    );
    if (!resp.ok) {
      console.error(`timelines:fetch HTTP ${resp.status} for ${matchId}`);
      return null;
    }
    const rows = await resp.json();
    return Array.isArray(rows) && rows[0]?.timeline ? rows[0].timeline : null;
  } catch (e) {
    console.error(`timelines:fetch failed for ${matchId}:`, e);
    return null;
  }
});

ipcMain.handle("games:fetch", async () => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;
  const steamId = config.steam_id;
  const localOnly = !!config.local_only;

  const local = readLocalMatchPlayers();
  console.log(`[games:fetch] local_only=${localOnly} local=${local.length} steam=${steamId}`);

  // local_only short-circuit: no Supabase fetch, return local only.
  if (localOnly) {
    local.sort((a, b) => (b.played_at || "").localeCompare(a.played_at || ""));
    console.log(`[games:fetch] returning ${local.length} local games`);
    return local;
  }

  if (!url || !key || !steamId) return local;

  let remote = [];
  try {
    const resp = await net.fetch(
      `${url}/rest/v1/games?select=*&user_id=eq.${steamId}&order=played_at.desc&limit=100`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      }
    );
    if (resp.ok) remote = await resp.json();
  } catch (e) {
    console.error("games:fetch error:", e);
  }

  // Merge local + remote, dedupe by id (local entries shadow remote),
  // sort by played_at desc.
  const seen = new Set();
  const merged = [];
  for (const g of [...local, ...remote]) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    merged.push(g);
  }
  merged.sort((a, b) => (b.played_at || "").localeCompare(a.played_at || ""));
  return merged;
});

ipcMain.handle("games:update", async (_event, gameId, fields) => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;

  if (!url || !key) return false;

  try {
    const resp = await net.fetch(
      `${url}/rest/v1/games?id=eq.${gameId}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(fields),
      }
    );
    return resp.ok;
  } catch (e) {
    console.error("games:update error:", e);
    return false;
  }
});

ipcMain.handle("games:delete", async (_event, gameId) => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;

  if (!url || !key) return false;

  try {
    const resp = await net.fetch(
      `${url}/rest/v1/games?id=eq.${gameId}`,
      {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "return=minimal",
        },
      }
    );
    return resp.ok;
  } catch (e) {
    console.error("games:delete error:", e);
    return false;
  }
});

// ── Drodo profile IPC (fetch from Supabase + Drodo API) ─────────────────────

const DRODO_BASE = "http://autochess.ppbizon.com";

ipcMain.handle("drodo:fetch", async () => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;
  const steamId = config.steam_id;

  if (!url || !key || !steamId) return null;

  try {
    const [profileResp, seasonsResp] = await Promise.all([
      net.fetch(
        `${url}/rest/v1/drodo_profiles?select=mmr,max_mmr,mmr_level,season,season_games,chicken_count,fetched_at&steam_id=eq.${steamId}`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          },
        }
      ),
      net.fetch(
        `${url}/rest/v1/player_seasons?select=season,mmr,max_mmr,games_played&steam_id=eq.${steamId}&order=season.asc`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          },
        }
      ),
    ]);

    const profiles = profileResp.ok ? await profileResp.json() : [];
    const seasons = seasonsResp.ok ? await seasonsResp.json() : [];
    const profile = profiles[0] || null;

    if (!profile) return null;
    return { ...profile, seasons };
  } catch (e) {
    console.error("drodo:fetch error:", e);
    return null;
  }
});

ipcMain.handle("drodo:refresh", async () => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;
  const steamId = config.steam_id;

  if (!url || !key || !steamId) return null;

  // Fetch from Drodo API
  let drodoData;
  try {
    const resp = await net.fetch(`${DRODO_BASE}/courier/get/@${steamId}`);
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json.err !== 0 || !json.user_info?.[steamId]) return null;
    drodoData = json.user_info[steamId];
  } catch (e) {
    console.error("drodo:refresh API error:", e);
    return null;
  }

  // Find current season
  let maxSeason = 0;
  let season = "";
  for (const k of Object.keys(drodoData)) {
    const m = k.match(/^mmr_s(\d+)$/);
    if (m) {
      const n = parseInt(m[1]);
      if (n > maxSeason) { maxSeason = n; season = `s${n}`; }
    }
  }

  const mmrKey = season ? `mmr_${season}` : null;
  const maxMmrKey = season ? `max_mmr_${season}` : null;
  const matchKey = season ? `match_${season}` : null;
  const now = new Date().toISOString();

  const profile = {
    steam_id: steamId,
    mmr: mmrKey ? Number(drodoData[mmrKey]) || null : null,
    max_mmr: maxMmrKey ? Number(drodoData[maxMmrKey]) || null : null,
    mmr_level: Number(drodoData.mmr_level) || null,
    season: season || null,
    season_games: matchKey ? Number(drodoData[matchKey]) || null : null,
    chicken_count: Number(drodoData.chicken_count) || 0,
    fetched_at: now,
  };

  // Upsert profile into Supabase
  try {
    await net.fetch(
      `${url}/rest/v1/drodo_profiles`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(profile),
      }
    );
  } catch (e) {
    console.error("drodo:refresh upsert profile error:", e);
  }

  // Extract and upsert all season snapshots
  const seasonRows = [];
  for (const k of Object.keys(drodoData)) {
    const m = k.match(/^mmr_s(\d+)$/);
    if (m) {
      const n = m[1];
      seasonRows.push({
        steam_id: steamId,
        season: `s${n}`,
        mmr: Number(drodoData[`mmr_s${n}`]) || null,
        max_mmr: Number(drodoData[`max_mmr_s${n}`]) || null,
        games_played: Number(drodoData[`match_s${n}`]) || null,
        fetched_at: now,
      });
    }
  }

  if (seasonRows.length > 0) {
    try {
      await net.fetch(
        `${url}/rest/v1/player_seasons`,
        {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(seasonRows),
        }
      );
    } catch (e) {
      console.error("drodo:refresh upsert seasons error:", e);
    }
  }

  // Return the fresh data
  return { ...profile, seasons: seasonRows };
});

// ── Units data IPC ───────────────────────────────────────────────────────────

ipcMain.handle("data:units", async () => {
  const unitsPath = path.join(RESOURCES_DIR, "data", "units.json");
  if (!fs.existsSync(unitsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(unitsPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Synergies data IPC ────────────────────────────────────────────────────────

ipcMain.handle("data:synergies", async () => {
  const synPath = path.join(RESOURCES_DIR, "data", "synergies.json");
  if (!fs.existsSync(synPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(synPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Relics data IPC ──────────────────────────────────────────────────────────

ipcMain.handle("data:relics", async () => {
  const relicPath = path.join(RESOURCES_DIR, "data", "relics.json");
  if (!fs.existsSync(relicPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(relicPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Full units data IPC ──────────────────────────────────────────────────────

ipcMain.handle("data:units_full", async () => {
  const fullPath = path.join(RESOURCES_DIR, "data", "units_full.json");
  if (!fs.existsSync(fullPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Items data IPC ───────────────────────────────────────────────────────────

ipcMain.handle("data:items", async () => {
  const itemsPath = path.join(RESOURCES_DIR, "data", "items.json");
  if (!fs.existsSync(itemsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(itemsPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Talents data IPC ─────────────────────────────────────────────────────────

ipcMain.handle("data:talents", async () => {
  const talentsPath = path.join(RESOURCES_DIR, "data", "talents.json");
  if (!fs.existsSync(talentsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(talentsPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Replay protocol ──────────────────────────────────────────────────────────

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
  {
    scheme: "screenshot",
    privileges: {
      standard: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

// ── App lifecycle ────────────────────────────────────────────────────────────

app.on("second-instance", () => {
  if (app.isReady()) {
    focusMainWindow();
  } else {
    app.whenReady().then(() => setTimeout(focusMainWindow, 0));
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  // Handle replay:// protocol with Range request support for fast seeking
  protocol.handle("replay", (request) => {
    const filename = decodeURIComponent(
      request.url.replace("replay://video/", "")
    );
    const filePath = path.join(REPLAY_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.get("Range");

    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        return new Response(fs.createReadStream(filePath, { start, end }), {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkSize),
            "Content-Type": "video/mp4",
          },
        });
      }
    }

    return new Response(fs.createReadStream(filePath), {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileSize),
        "Content-Type": "video/mp4",
      },
    });
  });

  // Handle icons:// protocol for serving local icon files
  protocol.handle("icons", (request) => {
    // icons://type/name.png → data/icons/type/name.png
    const urlPath = decodeURIComponent(
      request.url.replace("icons://", "")
    );
    const filePath = path.join(ICONS_DIR, urlPath);

    // Prevent path traversal
    if (!filePath.startsWith(ICONS_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(`file://${filePath}`);
  });

  // Handle screenshot:// protocol for serving local screenshot files
  protocol.handle("screenshot", (request) => {
    const filePath = decodeURIComponent(request.url.replace("screenshot://", ""));

    if (filePath.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    return new Response(buf, {
      status: 200,
      headers: { "Content-Type": mime },
    });
  });

  // Remove the default menu bar (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  closeToTray = loadCloseToTray();

  createTray();
  createWindow();
  createWidget();
  createNotificationWindow();
  startDotaPoller();
  registerShortcuts();
  startPython();
  startTrackerLogWatcher();
  startDotaLogWatcher();

  app.on("activate", () => {
    focusMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (trackerLogWatcher) {
    try { trackerLogWatcher.close(); } catch {}
    trackerLogWatcher = null;
  }
  if (dotaLogWatcher) {
    try { dotaLogWatcher.close(); } catch {}
    dotaLogWatcher = null;
  }
  if (dotaPollInterval) clearInterval(dotaPollInterval);
  for (const timer of notificationTimers.values()) {
    clearTimeout(timer);
  }
  notificationTimers.clear();
  notificationItems.length = 0;

  // Destroy tray
  if (tray) {
    tray.destroy();
    tray = null;
  }

  // Shut down Python
  if (pythonProcess) {
    sendToPython({ cmd: "quit" });
    setTimeout(() => {
      if (pythonProcess) {
        pythonProcess.kill();
      }
    }, 3000);
  }
});

app.on("window-all-closed", () => {
  // Don't quit when close-to-tray is active — the window is just hidden
  if (!closeToTray) {
    app.quit();
  }
});

// ── Replay IPC handlers ─────────────────────────────────────────────────────

ipcMain.handle("replays:list", async () => {
  if (!fs.existsSync(REPLAY_DIR)) return [];

  const files = fs.readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".mp4"));

  return files
    .map((name) => {
      const filePath = path.join(REPLAY_DIR, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        size: stat.size,
        mtime: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle("replays:delete", async (_event, filename) => {
  const filePath = path.join(REPLAY_DIR, filename);
  if (!filePath.startsWith(REPLAY_DIR)) return false;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
});

ipcMain.handle("replays:stats", async () => {
  if (!fs.existsSync(REPLAY_DIR)) return { count: 0, totalBytes: 0 };

  const files = fs.readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".mp4"));
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += fs.statSync(path.join(REPLAY_DIR, f)).size;
  }
  return { count: files.length, totalBytes };
});

ipcMain.handle("replays:openFolder", async () => {
  const { shell } = require("electron");
  shell.openPath(REPLAY_DIR);
});

ipcMain.handle("replays:exists", async (_event, filename) => {
  if (!filename) return false;
  const filePath = path.join(REPLAY_DIR, filename);
  if (!filePath.startsWith(REPLAY_DIR)) return false;
  return fs.existsSync(filePath);
});

// ── Screenshot IPC handlers ────────────────────────────────────────────────

function loadScreenshotManifest() {
  if (!fs.existsSync(SCREENSHOT_MANIFEST)) return {};
  try {
    return JSON.parse(fs.readFileSync(SCREENSHOT_MANIFEST, "utf-8"));
  } catch {
    return {};
  }
}

ipcMain.handle("screenshots:list", async () => {
  if (!fs.existsSync(SCREENSHOT_DIR)) return [];

  const manifest = loadScreenshotManifest();
  const files = fs
    .readdirSync(SCREENSHOT_DIR)
    .filter((f) => /\.(png|jpg|jpeg)$/i.test(f));

  return files
    .map((name) => {
      const filePath = path.join(SCREENSHOT_DIR, name);
      const stat = fs.statSync(filePath);
      const stem = path.basename(name, path.extname(name));
      const parsePath = path.join(SCREENSHOT_DIR, `${stem}.parse.json`);
      const entry = manifest[name] || {};
      return {
        name,
        path: filePath,
        size: stat.size,
        mtime: stat.mtimeMs,
        uploaded: !!entry.uploaded_at,
        hasParsed: fs.existsSync(parsePath),
        hasImported: !!entry.imported_at,
        screenType: entry.screen_type || null,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle("screenshots:delete", async (_event, filename) => {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  if (!filePath.startsWith(SCREENSHOT_DIR)) return false;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    // Also remove parse result
    const stem = path.basename(filename, path.extname(filename));
    const parsePath = path.join(SCREENSHOT_DIR, `${stem}.parse.json`);
    if (fs.existsSync(parsePath)) fs.unlinkSync(parsePath);
    // Also remove from manifest
    const manifest = loadScreenshotManifest();
    if (manifest[filename]) {
      delete manifest[filename];
      fs.writeFileSync(SCREENSHOT_MANIFEST, JSON.stringify(manifest, null, 2));
    }
    return true;
  }
  return false;
});

ipcMain.handle("screenshots:openFolder", async () => {
  const { shell } = require("electron");
  shell.openPath(SCREENSHOT_DIR);
});

ipcMain.handle("screenshots:thumbnail", async (_event, filename) => {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  if (!filePath.startsWith(SCREENSHOT_DIR)) return null;
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
});

ipcMain.handle("screenshots:getParseResult", async (_event, filename) => {
  const stem = path.basename(filename, path.extname(filename));
  const parsePath = path.join(SCREENSHOT_DIR, `${stem}.parse.json`);
  if (!fs.existsSync(parsePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(parsePath, "utf-8"));
  } catch {
    return null;
  }
});

ipcMain.handle("screenshots:updateParseRow", async (_event, filename, rowIndex, fields) => {
  const stem = path.basename(filename, path.extname(filename));
  const parsePath = path.join(SCREENSHOT_DIR, `${stem}.parse.json`);
  if (!fs.existsSync(parsePath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(parsePath, "utf-8"));
    if (!data.rows || rowIndex < 0 || rowIndex >= data.rows.length) return false;
    Object.assign(data.rows[rowIndex], fields);
    fs.writeFileSync(parsePath, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
});

// ── Parser Lab (regions config + screenshot listing) ───────────────────────

const FIXTURES_DIR = path.join(__dirname, "..", "backend", "tests", "fixtures");
const DATA_DIR = path.join(RESOURCES_DIR, "data");
const LAB_SCREENSHOTS = path.join(DATA_DIR, "screenshots");
const DEFAULT_REGIONS_CONFIG_PATH = path.join(DATA_DIR, "regions_config.json");
const USER_REGIONS_CONFIG_PATH = path.join(DAC_DIR, "regions_config.json");
const STEAM_BASE = "C:\\Program Files (x86)\\Steam\\userdata";

ipcMain.handle("lab:listScreenshots", async () => {
  const groups = [];
  function scanDir(dir, label) {
    if (!fs.existsSync(dir)) return;
    const items = [];
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(jpg|jpeg|png)$/i.test(name)) continue;
      const filePath = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      items.push({ name, path: filePath, size: stat.size, mtime: stat.mtimeMs });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    if (items.length > 0) groups.push({ label, files: items });
  }
  scanDir(LAB_SCREENSHOTS, "Reference");
  scanDir(SCREENSHOT_DIR, "DAC Tracker");
  if (fs.existsSync(STEAM_BASE)) {
    for (const user of fs.readdirSync(STEAM_BASE)) {
      const ssDir = path.join(STEAM_BASE, user, "760", "remote", "570", "screenshots");
      scanDir(ssDir, "Steam");
    }
  }
  return groups;
});

ipcMain.handle("lab:loadConfig", async () => {
  const result = { defaults: null, overrides: null };
  try {
    if (fs.existsSync(DEFAULT_REGIONS_CONFIG_PATH)) {
      result.defaults = JSON.parse(fs.readFileSync(DEFAULT_REGIONS_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  try {
    if (fs.existsSync(USER_REGIONS_CONFIG_PATH)) {
      result.overrides = JSON.parse(fs.readFileSync(USER_REGIONS_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return result;
});

ipcMain.handle("lab:saveConfig", async (_event, config) => {
  fs.mkdirSync(DAC_DIR, { recursive: true });
  fs.writeFileSync(USER_REGIONS_CONFIG_PATH, JSON.stringify(config, null, 2));
  return { ok: true, path: USER_REGIONS_CONFIG_PATH };
});

ipcMain.handle("lab:resetConfig", async () => {
  if (fs.existsSync(USER_REGIONS_CONFIG_PATH)) {
    fs.unlinkSync(USER_REGIONS_CONFIG_PATH);
  }
  return { ok: true };
});

ipcMain.handle("lab:parseFull", async (_event, payload) => {
  const reqId = nextReqId();
  return new Promise((resolve) => {
    labResolvers.set(reqId, resolve);
    sendToPython({ cmd: "lab_parse_full", path: payload?.path || "", req_id: reqId });
    setTimeout(() => {
      if (labResolvers.has(reqId)) {
        labResolvers.delete(reqId);
        resolve({ ok: false, error: "lab_parse_full timed out (60s)" });
      }
    }, 60000);
  });
});

ipcMain.handle("lab:parseRegion", async (_event, payload) => {
  const reqId = nextReqId();
  return new Promise((resolve) => {
    labResolvers.set(reqId, resolve);
    sendToPython({
      cmd: "lab_parse_region",
      path: payload?.path || "",
      name: payload?.name || "",
      category: payload?.category || "",
      bbox: payload?.bbox || [],
      req_id: reqId,
    });
    setTimeout(() => {
      if (labResolvers.has(reqId)) {
        labResolvers.delete(reqId);
        resolve({ ok: false, error: "lab_parse_region timed out (30s)" });
      }
    }, 30000);
  });
});

ipcMain.handle("lab:listFixtures", async () => {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  const files = [];
  for (const name of fs.readdirSync(FIXTURES_DIR)) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(FIXTURES_DIR, name);
    let body;
    try { body = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { continue; }
    files.push({
      name,
      path: filePath,
      screenshot_path: body?.screenshot_path || "",
      screen_type: body?.screen_type || "",
      row_count: Array.isArray(body?.rows) ? body.rows.length : 0,
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
});

ipcMain.handle("lab:saveFixture", async (_event, fixtureName, data) => {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const outPath = path.join(FIXTURES_DIR, `${fixtureName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  return { ok: true, path: outPath };
});

ipcMain.handle("lab:deleteFixture", async (_event, fixtureName) => {
  const target = path.join(FIXTURES_DIR, `${fixtureName}.json`);
  if (target.startsWith(FIXTURES_DIR) && fs.existsSync(target)) {
    fs.unlinkSync(target);
    return { ok: true };
  }
  return { ok: false, error: "fixture not found" };
});

ipcMain.handle("lab:imageData", async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
});

let pytestProc = null;
let pytestSeq = 0;

ipcMain.handle("lab:runFixtures", async (_event) => {
  const { spawn } = require("child_process");
  if (pytestProc) {
    try { pytestProc.kill(); } catch {}
    pytestProc = null;
  }
  pytestSeq++;
  const seq = pytestSeq;
  const cwd = path.join(__dirname, "backend");
  const py = process.env.DAC_PYTHON || "python";
  const proc = spawn(py, ["-m", "pytest", "tests/test_fixtures.py", "-v", "--no-header", "--tb=short"], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  pytestProc = proc;

  const broadcast = (kind, text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("lab:pytestOutput", { seq, kind, text });
    }
  };
  proc.stdout.on("data", (d) => broadcast("stdout", d.toString()));
  proc.stderr.on("data", (d) => broadcast("stderr", d.toString()));
  proc.on("close", (code) => {
    broadcast("exit", `\n[exit code ${code}]\n`);
    if (pytestProc === proc) pytestProc = null;
  });
  proc.on("error", (err) => broadcast("error", `\n[spawn error: ${err.message}]\n`));

  return { ok: true, seq };
});

