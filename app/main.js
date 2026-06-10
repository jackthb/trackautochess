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
const { spawn } = require("child_process");
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
const ICONS_DIR = DESKTOP_PATHS.iconsDir;
const ICON_FILENAME = DESKTOP_PATHS.iconFilename;
const CONTENT_DIR = path.join(RESOURCES_DIR, "content");
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const IS_DEV = !IS_PACKAGED && process.argv.includes("--dev");
const UPDATE_CHECK_INTERVAL_MS = 6 * 3600 * 1000;
const GITHUB_RELEASES_API = "https://api.github.com/repos/jackthb/dac-tools/releases/latest";

if (!gotSingleInstanceLock) {
  app.quit();
}

// Ensure dirs exist
for (const dir of [DAC_DIR, REPLAY_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let mainWindow = null;
let backendProcess = null;
let backendRL = null;
let backendRestarting = false;
let backendRestartTimer = null;
let backendWatchers = [];
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

let runtimeGameDataCache = null;

function parseSemver(tag) {
  const match = String(tag || "").match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : [0, 0, 0];
}

function isNewerVersion(remoteTag, currentVersion) {
  const remote = parseSemver(remoteTag);
  const current = parseSemver(currentVersion);
  for (let i = 0; i < 3; i += 1) {
    if (remote[i] > current[i]) return true;
    if (remote[i] < current[i]) return false;
  }
  return false;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Track-Auto-Chess-Updater",
        },
        timeout: 15000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GitHub releases API returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("GitHub releases API timed out")));
    req.on("error", reject);
  });
}

async function checkForUpdate() {
  if (!IS_PACKAGED) return;
  try {
    const data = await fetchJson(GITHUB_RELEASES_API);
    const remoteTag = data?.tag_name || "";
    if (!remoteTag || !isNewerVersion(remoteTag, app.getVersion())) return;
    const asset = (data.assets || []).find((item) =>
      String(item?.name || "").toLowerCase().endsWith(".exe"),
    );
    if (!asset?.browser_download_url) return;
    if (trackerStatus.update?.tag === remoteTag) return;
    handleBackendEvent({
      type: "update_available",
      tag: remoteTag,
      download_url: asset.browser_download_url,
      html_url: data.html_url || "",
    });
  } catch (e) {
    console.error("Update check failed:", e);
  }
}

function startUpdateLoop() {
  if (!IS_PACKAGED) return;
  setTimeout(checkForUpdate, 10_000);
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function materializeContentEntity(entity) {
  const output = { ...(entity?.source || {}) };
  if (entity?.icon) output.icon = entity.icon;
  for (const [key, value] of Object.entries(entity?.overrides || {})) {
    if (value !== null && value !== undefined) output[key] = value;
  }
  return output;
}

function readContentCollection(relativeDir) {
  const dir = path.join(CONTENT_DIR, "game", relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJsonFile(path.join(dir, file), null))
    .filter(Boolean);
}

function getRuntimeGameData() {
  if (runtimeGameDataCache) return runtimeGameDataCache;

  const aliases = readJsonFile(path.join(CONTENT_DIR, "game", "aliases.json"), {});
  const items = readJsonFile(path.join(CONTENT_DIR, "game", "curated-items.json"), {});

  const unitsFull = {};
  for (const entry of readContentCollection("units")) {
    unitsFull[entry.name] = {
      id: entry.gameId,
      ...materializeContentEntity(entry),
    };
  }

  const synergies = {};
  for (const entry of readContentCollection("synergies")) {
    synergies[entry.gameId] = materializeContentEntity(entry);
  }

  const relics = {};
  for (const entry of readContentCollection("relics")) {
    relics[entry.gameId] = materializeContentEntity(entry);
  }

  const itemsFull = {};
  for (const entry of readContentCollection("items")) {
    itemsFull[entry.gameId] = materializeContentEntity(entry);
  }

  const talents = {};
  for (const entry of readContentCollection("talents")) {
    const { slot, ...talent } = entry;
    talents[slot] = talent;
  }

  runtimeGameDataCache = {
    aliases,
    items,
    unitsFull,
    synergies,
    relics: { relics },
    itemsFull,
    talents,
  };
  return runtimeGameDataCache;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

// ── Rust backend subprocess ──────────────────────────────────────────────────

function getBackendCommand() {
  return DESKTOP_PATHS.backendCommand;
}

function startBackend() {
  if (backendProcess) return;

  const { command, args, cwd } = getBackendCommand();

  if ((command.includes(path.sep) || path.isAbsolute(command)) && !fs.existsSync(command)) {
    console.error(`Backend not found at ${command}`);
    return;
  }

  console.log(`Starting ${DESKTOP_PATHS.backendKind} backend: ${command} ${args.join(" ")}`);
  appendTrackerLog("INFO", `Starting ${DESKTOP_PATHS.backendKind} backend: ${command} ${args.join(" ")}`);
  appendTrackerLog("INFO", `Tracker log path: ${TRACKER_LOG_PATH}`);

  backendProcess = spawn(command, args, {
    cwd,
    env: { ...process.env, TRACK_AUTO_CHESS_LOG_PATH: TRACKER_LOG_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Read stdout line by line (JSON lines protocol)
  backendRL = readline.createInterface({ input: backendProcess.stdout });
  backendRL.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      handleBackendEvent(msg);
    } catch (e) {
      console.error("Failed to parse backend output:", line);
      appendTrackerLog("ERROR", `Failed to parse backend output: ${line}`);
    }
  });

  // Log stderr
  backendProcess.stderr.on("data", (data) => {
    const text = data.toString().trim();
    console.error(`[backend stderr] ${text}`);
    if (text) appendTrackerLog("ERROR", `[backend stderr] ${text}`);
  });

  backendProcess.on("close", (code) => {
    console.log(`Backend process exited with code ${code}`);
    appendTrackerLog("WARNING", `Backend process exited with code ${code}`);
    backendProcess = null;
    backendRL = null;

    if (backendRestarting) {
      backendRestarting = false;
      startBackend();
      return;
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tracker:event", {
        type: "error",
        message: `${DESKTOP_PATHS.backendKind} backend exited (code ${code})`,
      });
    }
  });

  backendProcess.on("error", (err) => {
    console.error("Failed to start backend:", err);
    appendTrackerLog("ERROR", `Failed to start backend: ${err?.message || err}`);
  });
}

function restartBackend(reason) {
  if (IS_PACKAGED) return;
  console.log(`Restarting backend: ${reason}`);

  if (!backendProcess) {
    startBackend();
    return;
  }

  backendRestarting = true;
  sendToBackend({ cmd: "quit" });
  setTimeout(() => {
    if (backendProcess && backendRestarting) {
      backendProcess.kill();
    }
  }, 1500);
}

function scheduleBackendRestart(reason) {
  if (backendRestartTimer) clearTimeout(backendRestartTimer);
  backendRestartTimer = setTimeout(() => {
    backendRestartTimer = null;
    restartBackend(reason);
  }, 350);
}

function startBackendDevWatcher() {
  if (!IS_DEV) return;

  const backendDir = DESKTOP_PATHS.trackerDir;
  if (!fs.existsSync(backendDir)) return;

  try {
    const watcher = fs.watch(backendDir, { recursive: true }, (_event, filename) => {
      const normalized = String(filename || "").replace(/\\/g, "/");
      if (!normalized.endsWith(".rs")) return;
      if (normalized.includes("/.venv/") || normalized.includes("/build/") || normalized.includes("/target/")) return;
      scheduleBackendRestart(filename);
    });
    backendWatchers.push(watcher);
    console.log(`Watching ${DESKTOP_PATHS.backendKind} backend for hot restart: ${backendDir}`);
  } catch (e) {
    console.error(`Failed to watch backend dir ${backendDir}:`, e);
  }
}

function sendToBackend(cmd) {
  if (!backendProcess || !backendProcess.stdin.writable) {
    console.error("Backend process not running — cannot send:", cmd);
    appendTrackerLog("ERROR", `Backend process not running — cannot send: ${JSON.stringify(cmd)}`);
    return;
  }
  const line = JSON.stringify(cmd) + "\n";
  console.log("sendToBackend:", line.trim());
  appendTrackerLog("INFO", `Command sent: ${cmd?.cmd ?? "unknown"}`);
  backendProcess.stdin.write(line);
}

function handleBackendEvent(msg) {
  logBackendEvent(msg);

  // Forward all events to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tracker:event", msg);
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
        }
      }
    );
  }

  checkDota();
  dotaPollInterval = setInterval(checkDota, 3000);
}

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

  mainWindow.on("close", () => {
    isQuitting = true;
    app.quit();
  });
}

// ── Global shortcuts ─────────────────────────────────────────────────────────

function registerShortcuts() {
  globalShortcut.register("F6", () => {
    sendToBackend({ cmd: "capture" });
  });
  globalShortcut.register("F7", () => {
    sendToBackend({ cmd: "toggle_recording" });
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

// ── Tracker IPC (renderer → main → Rust backend) ────────────────────────────

ipcMain.on("tracker:command", (_event, cmd) => {
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
  sendToBackend(cmd);
});

// ── desktop app log watcher (bypasses backend→Electron→React IPC) ───────────
//
// Keep tracker logs in Electron's canonical userData directory. On Windows this
// is AppData/Roaming/<app-name>/logs/tracker.log for both dev and packaged app
// runs. Do not add fallback tracker log locations; split logs make diagnostics
// ambiguous.

const APP_LOG_DIR = path.join(app.getPath("userData"), "logs");
const TRACKER_LOG_PATH = path.join(APP_LOG_DIR, "tracker.log");
const DOTA_CONSOLE_LOG_CANDIDATES = [
  "C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
  "C:/Program Files/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
];
const TRACKER_LOG_INITIAL_TAIL_BYTES = 256 * 1024; // ~2.5k lines
const DOTA_LOG_INITIAL_TAIL_BYTES = 128 * 1024;
// console.log is full of engine/bootstrap noise. Drop high-volume or irrelevant
// lines so the Log tab stays readable — keep everything else, especially our
// DAC_* markers and [stringtables] / DOTA_GAMERULES_STATE_* lines.
const DOTA_NOISE_RE = /\[GCClient\]|^WriteSteamRemoteStorageFileAsync|^CAsyncWriteInProgress|^\[SteamNetSockets\]|\[Filesystem\].*\.vpk\b|\bbad VPK magic\b|\bVPK magic\b|\bvpk:.*\.vpk:/i;
let trackerLogWatcher = null;
let trackerLogOffset = 0;
let dotaLogWatcher = null;
let dotaLogOffset = 0;
let dotaLogPath = null;

function trackerLogTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function appendTrackerLog(level, message) {
  try {
    fs.mkdirSync(APP_LOG_DIR, { recursive: true });
    const normalizedLevel = String(level || "INFO").toUpperCase().padEnd(7, " ");
    const text = String(message || "").replace(/\r?\n/g, "\n  ");
    fs.appendFileSync(TRACKER_LOG_PATH, `${trackerLogTimestamp()}  ${normalizedLevel} ${text}\n`, "utf-8");
  } catch (e) {
    console.error("Failed to append tracker.log:", e);
  }
}

function logBackendEvent(msg) {
  if (!msg || typeof msg !== "object") return;
  const type = String(msg.type || "");
  if (!type) return;
  if (["status", "nettable_status", "nettable_state", "nettable_rows", "log"].includes(type)) {
    return;
  }
  const level = type === "error" || type.endsWith("_error") ? "ERROR" : "INFO";
  const message = msg.message || msg.error || summarizeBackendEvent(msg);
  appendTrackerLog(level, `Backend event ${type}: ${message}`);
}

function summarizeBackendEvent(msg) {
  const summary = { ...msg };
  delete summary.rows;
  delete summary.state;
  delete summary.players;
  return JSON.stringify(summary);
}

function parseTrackerLogLines(text) {
  const entries = [];
  const lineRegex = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue;
    const m = raw.match(lineRegex);
    if (m) {
      if (!m[4].trim()) continue;
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
    if (DOTA_NOISE_RE.test(raw)) continue;
    const m = raw.match(lineRegex);
    if (m) {
      const msg = m[6].trim();
      if (!msg || DOTA_NOISE_RE.test(msg)) continue;
      const ts = new Date(`${year}-${m[1]}-${m[2]}T${m[3]}:${m[4]}:${m[5]}`).getTime() / 1000;
      entries.push({ type: "log", source: "dota", ts, level: "INFO", msg });
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

ipcMain.handle("trackerLog:paths", () => ({
  tracker: TRACKER_LOG_PATH,
  dota: dotaLogPath || resolveDotaLogPath(),
}));

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

const MMR_LEVEL_RANKS = [
  "Pawn-1",
  "Pawn-2",
  "Pawn-3",
  "Pawn-4",
  "Pawn-5",
  "Pawn-6",
  "Pawn-7",
  "Pawn-8",
  "Pawn-9",
  "Knight-1",
  "Knight-2",
  "Knight-3",
  "Knight-4",
  "Knight-5",
  "Knight-6",
  "Knight-7",
  "Knight-8",
  "Knight-9",
  "Bishop-1",
  "Bishop-2",
  "Bishop-3",
  "Bishop-4",
  "Bishop-5",
  "Bishop-6",
  "Bishop-7",
  "Bishop-8",
  "Bishop-9",
  "Rook-1",
  "Rook-2",
  "Rook-3",
  "Rook-4",
  "Rook-5",
  "Rook-6",
  "Rook-7",
  "Rook-8",
  "Rook-9",
  "King",
  "Queen",
];

function mmrLevelToAppRank(level) {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1 || n > MMR_LEVEL_RANKS.length) return null;
  return MMR_LEVEL_RANKS[n - 1];
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

  if (!url || !key || !steamId) return [];

  try {
    const resp = await net.fetch(
      `${url}/rest/v1/match_players?select=*&steam_id=eq.${steamId}&order=played_at.desc&limit=50`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      }
    );
    if (!resp.ok) {
      console.error(`games:fetch HTTP ${resp.status}`);
      return [];
    }
    const rows = await resp.json();
    return rows.map((r) => ({
      id: r.id,
      user_id: String(r.steam_id),
      placement: String(r.placement),
      lineup: r.chess_lineup,
      synergies: r.synergies,
      talents: r.talents,
      relic: r.relic,
      relic_history: r.relic_history ?? null,
      level: r.hero_level ? String(r.hero_level) : null,
      wins: r.win_round,
      losses: r.lose_round,
      match_id: r.match_id,
      played_at: r.played_at || "",
      created_at: r.created_at || "",
      rank: mmrLevelToAppRank(r.mmr_level),
      rank_change: null,
      wl: null,
      screenshot: null,
      replay: null,
      notes: null,
    }));
  } catch (e) {
    console.error("games:fetch error:", e);
    return [];
  }
});

ipcMain.handle("games:update", async (_event, gameId, fields) => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;

  if (!url || !key) return false;

  try {
    const resp = await net.fetch(
      `${url}/rest/v1/match_players?id=eq.${gameId}`,
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

// ── Drodo profile IPC (fetch from Supabase + Drodo API) ─────────────────────

const DRODO_BASE = "http://autochess.ppbizon.com";

function drodoUserRowToProfile(row, seasons = []) {
  if (!row) return null;
  return {
    mmr: row.drodo_mmr ?? null,
    max_mmr: row.drodo_max_mmr ?? null,
    mmr_level: row.drodo_mmr_level ?? null,
    season: row.drodo_season ?? null,
    season_games: row.drodo_season_games ?? null,
    chicken_count: row.drodo_chicken_count ?? 0,
    fetched_at: row.drodo_last_fetched_at ?? null,
    seasons,
  };
}

function drodoProfileToUserPayload(profile) {
  return {
    steam_id: profile.steam_id,
    drodo_mmr: profile.mmr,
    drodo_max_mmr: profile.max_mmr,
    drodo_mmr_level: profile.mmr_level,
    drodo_season: profile.season,
    drodo_season_games: profile.season_games,
    drodo_candy: profile.candy,
    drodo_chicken_count: profile.chicken_count,
    drodo_raw_data: profile.raw_data,
    drodo_last_fetched_at: profile.fetched_at,
    drodo_profile_missing: false,
  };
}

ipcMain.handle("drodo:fetch", async () => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;
  const steamId = config.steam_id;

  if (!url || !key || !steamId) return { error: "Tracker profile is not configured." };

  try {
    const [profileResp, seasonsResp] = await Promise.all([
      net.fetch(
        `${url}/rest/v1/users?select=steam_id,drodo_mmr,drodo_max_mmr,drodo_mmr_level,drodo_season,drodo_season_games,drodo_chicken_count,drodo_last_fetched_at&steam_id=eq.${steamId}`,
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

    if (!profileResp.ok) {
      return { error: `Could not load Auto Chess profile (${profileResp.status}).` };
    }
    if (!seasonsResp.ok) {
      return { error: `Could not load Auto Chess seasons (${seasonsResp.status}).` };
    }

    const profiles = await profileResp.json();
    const seasons = await seasonsResp.json();
    const profile = profiles[0] || null;

    if (!profile) return null;
    return drodoUserRowToProfile(profile, seasons);
  } catch (e) {
    console.error("drodo:fetch error:", e);
    return { error: e?.message || "Could not load Auto Chess profile." };
  }
});

ipcMain.handle("drodo:refresh", async () => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;
  const steamId = config.steam_id;

  if (!url || !key || !steamId) return { error: "Tracker profile is not configured." };

  // Fetch from Drodo API
  let drodoData;
  try {
    const resp = await net.fetch(`${DRODO_BASE}/courier/get/@${steamId}`);
    if (!resp.ok) return { error: `Drodo profile API returned ${resp.status}.` };
    const json = await resp.json();
    if (json.err !== 0 || !json.user_info?.[steamId]) {
      return { error: "Drodo profile was not found for this Steam account." };
    }
    drodoData = json.user_info[steamId];
  } catch (e) {
    console.error("drodo:refresh API error:", e);
    return { error: e?.message || "Could not refresh Auto Chess profile." };
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
    queen_rank: Number(drodoData.queen_rank) || null,
    season: season || null,
    season_games: matchKey ? Number(drodoData[matchKey]) || null : null,
    candy: Number(drodoData.candy) || null,
    chicken_count: Number(drodoData.chicken_count) || 0,
    raw_data: drodoData,
    fetched_at: now,
  };

  // Upsert profile into Supabase
  try {
    const userPayload = drodoProfileToUserPayload(profile);
    await net.fetch(
      `${url}/rest/v1/users`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(userPayload),
      }
    );
  } catch (e) {
    console.error("drodo:refresh upsert profile error:", e);
    return { error: e?.message || "Could not save Auto Chess profile." };
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
  const data = getRuntimeGameData();
  return { units: data.unitsFull, aliases: data.aliases };
});

// ── Synergies data IPC ────────────────────────────────────────────────────────

ipcMain.handle("data:synergies", async () => {
  return getRuntimeGameData().synergies;
});

// ── Relics data IPC ──────────────────────────────────────────────────────────

ipcMain.handle("data:relics", async () => {
  return getRuntimeGameData().relics;
});

// ── Full units data IPC ──────────────────────────────────────────────────────

ipcMain.handle("data:units_full", async () => {
  return getRuntimeGameData().unitsFull;
});

// ── Items data IPC ───────────────────────────────────────────────────────────

ipcMain.handle("data:items", async () => {
  return getRuntimeGameData().items;
});

ipcMain.handle("data:items_full", async () => {
  return getRuntimeGameData().itemsFull;
});

// ── Talents data IPC ─────────────────────────────────────────────────────────

ipcMain.handle("data:talents", async () => {
  return getRuntimeGameData().talents;
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

  // Remove the default menu bar (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  createWindow();

  startDotaPoller();
  registerShortcuts();
  startBackend();
  startBackendDevWatcher();
  startTrackerLogWatcher();
  startDotaLogWatcher();
  startUpdateLoop();

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
  for (const watcher of backendWatchers) {
    try { watcher.close(); } catch {}
  }
  backendWatchers = [];
  if (backendRestartTimer) {
    clearTimeout(backendRestartTimer);
    backendRestartTimer = null;
  }
  if (dotaPollInterval) clearInterval(dotaPollInterval);

  // Shut down backend
  if (backendProcess) {
    sendToBackend({ cmd: "quit" });
    setTimeout(() => {
      if (backendProcess) {
        backendProcess.kill();
      }
    }, 3000);
  }
});

app.on("window-all-closed", () => {
  app.quit();
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
