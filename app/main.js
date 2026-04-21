const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  Menu,
  Tray,
  nativeImage,
  Notification,
  globalShortcut,
  dialog,
  screen,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const readline = require("readline");

const DAC_DIR = path.join(os.homedir(), ".dac");
const REPLAY_DIR = path.join(DAC_DIR, "replays");
const SCREENSHOT_DIR = path.join(DAC_DIR, "screenshots");
const SCREENSHOT_MANIFEST = path.join(SCREENSHOT_DIR, "manifest.json");
const IS_PACKAGED = app.isPackaged;
const RESOURCES_DIR = IS_PACKAGED
  ? process.resourcesPath
  : path.join(__dirname, "..");
const TRACKER_DIR = IS_PACKAGED
  ? path.join(RESOURCES_DIR, "headless")
  : path.join(__dirname, "backend");
const ICONS_DIR = IS_PACKAGED
  ? path.join(RESOURCES_DIR, "data", "icons")
  : path.join(__dirname, "..", "data", "icons");

// Ensure dirs exist
for (const dir of [DAC_DIR, REPLAY_DIR, SCREENSHOT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let mainWindow = null;
let overlayWindow = null;
let widgetWindow = null;
let calibrationWindow = null;
let tray = null;
let pythonProcess = null;
let pythonRL = null;
let overlayTimeout = null;
let dotaPollInterval = null;
let dotaOpen = false;
let closeToTray = true; // default: minimize to tray on close
let isQuitting = false; // true when quitting from tray or app.quit()
let trackerStatus = {
  recording: false,
  focused: false,
  logged_in: false,
  version: "",
  steam_id: "",
  steam_name: "",
  replay_enabled: true,
};

// ── Python subprocess ────────────────────────────────────────────────────────

function getBackendCommand() {
  if (IS_PACKAGED) {
    // Production: use PyInstaller-bundled headless.exe
    const exe = path.join(TRACKER_DIR, "headless.exe");
    return { command: exe, args: [], cwd: TRACKER_DIR };
  }
  // Dev: use Python from venv
  const pythonPath =
    process.platform === "win32"
      ? path.join(TRACKER_DIR, ".venv", "Scripts", "python.exe")
      : path.join(TRACKER_DIR, ".venv", "bin", "python");
  const scriptPath = path.join(TRACKER_DIR, "headless.py");
  return { command: pythonPath, args: [scriptPath], cwd: TRACKER_DIR };
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
  const iconExt = process.platform === "win32" ? "dac_tracker.ico" : "dac_tracker.png";
  const iconPath = path.join(ICONS_DIR, iconExt);
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

    case "sentinel_match":
      showOverlay();
      break;

    case "notification":
      showNotification(msg.title, msg.message);
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

    case "parse_result":
      // Switch to confirmation tab
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      break;

    case "debug_result":
    case "sentinel_result":
      if (debugResolve) {
        debugResolve(msg.data || { error: msg.error || "Unknown error" });
        debugResolve = null;
      }
      break;
  }
}

// ── Notifications ────────────────────────────────────────────────────────────

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// ── Overlay window ───────────────────────────────────────────────────────────

function showOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.size;

  // Position near Match History icon
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

  // Auto-dismiss after 120s
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

// ── Overlay IPC ──────────────────────────────────────────────────────────────

ipcMain.on("overlay:capture", () => {
  dismissOverlay();
  sendToPython({ cmd: "capture" });
});

ipcMain.on("overlay:dismiss", () => {
  dismissOverlay();
});

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

// ── Main window ──────────────────────────────────────────────────────────────

function createWindow() {
  const iconExt = process.platform === "win32" ? "dac_tracker.ico" : "dac_tracker.png";
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#08090b",
    icon: path.join(ICONS_DIR, iconExt),
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

ipcMain.handle("app:openFileDialog", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select MY MATCHES screenshot",
    defaultPath: path.join(DAC_DIR, "screenshots"),
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

ipcMain.handle("games:fetch", async () => {
  const config = loadTrackerConfig();
  const url = config.supabase_url;
  const key = config.supabase_key;
  const steamId = config.steam_id;

  if (!url || !key || !steamId) return [];

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
    if (!resp.ok) return [];
    return await resp.json();
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

app.whenReady().then(() => {
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
  startDotaPoller();
  registerShortcuts();
  startPython();

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (dotaPollInterval) clearInterval(dotaPollInterval);

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

// ── Calibration window ──────────────────────────────────────────────────────

const DATA_DIR = path.join(RESOURCES_DIR, "data");
const CALIBRATION_SCREENSHOTS = path.join(DATA_DIR, "screenshots");
const STEAM_BASE = "C:\\Program Files (x86)\\Steam\\userdata";

function openCalibrationWindow() {
  if (calibrationWindow && !calibrationWindow.isDestroyed()) {
    calibrationWindow.focus();
    return;
  }
  calibrationWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "DAC Calibration",
    webPreferences: {
      preload: path.join(__dirname, "preload-calibration.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  calibrationWindow.loadFile(path.join(__dirname, "calibration.html"));
  calibrationWindow.on("closed", () => { calibrationWindow = null; });
}

ipcMain.handle("app:openCalibration", () => {
  openCalibrationWindow();
});

function detectAR(filePath) {
  try {
    const buf = Buffer.alloc(32);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 32, 0);
    fs.closeSync(fd);
    let w, h;
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      w = buf.readUInt32BE(16);
      h = buf.readUInt32BE(20);
    } else if (buf[0] === 0xFF && buf[1] === 0xD8) {
      const full = fs.readFileSync(filePath);
      let offset = 2;
      while (offset < full.length - 8) {
        if (full[offset] !== 0xFF) break;
        const marker = full[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          h = full.readUInt16BE(offset + 5);
          w = full.readUInt16BE(offset + 7);
          break;
        }
        const segLen = full.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }
    if (w && h) return (w / h) > 2.0 ? "21:9" : "16:9";
    return null;
  } catch { return null; }
}

ipcMain.handle("calibration:listScreenshots", async (_event, arFilter) => {
  const groups = [];
  function scanDir(dir, label) {
    if (!fs.existsSync(dir)) return;
    const items = [];
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(jpg|jpeg|png)$/i.test(name)) continue;
      const filePath = path.join(dir, name);
      const ar = detectAR(filePath);
      if (arFilter && ar && ar !== arFilter) continue;
      const stat = fs.statSync(filePath);
      items.push({ name, path: filePath, size: stat.size, mtime: stat.mtimeMs });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    if (items.length > 0) groups.push({ label, files: items });
  }
  scanDir(CALIBRATION_SCREENSHOTS, "Reference");
  scanDir(SCREENSHOT_DIR, "DAC Tracker");
  if (fs.existsSync(STEAM_BASE)) {
    for (const user of fs.readdirSync(STEAM_BASE)) {
      const ssDir = path.join(STEAM_BASE, user, "760", "remote", "570", "screenshots");
      scanDir(ssDir, `Steam`);
    }
  }
  return groups;
});

ipcMain.handle("calibration:getScreenshot", async (_event, filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
});

ipcMain.handle("calibration:loadConfig", async () => {
  const configPath = path.join(DATA_DIR, "regions_config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch { return null; }
});

ipcMain.handle("calibration:saveConfig", async (_event, config) => {
  const configPath = path.join(DATA_DIR, "regions_config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return true;
});

let debugResolve = null;

ipcMain.handle("calibration:debugView", async (_event, payload) => {
  return new Promise((resolve) => {
    debugResolve = resolve;
    sendToPython({
      cmd: "debug_view",
      path: payload?.screenshotPath,
      screen: payload?.screen,
      regions: payload?.regions || {},
      aspect_ratio: payload?.aspectRatio || null,
    });
    setTimeout(() => {
      if (debugResolve === resolve) {
        debugResolve = null;
        resolve({ error: "View debug timed out (30s)" });
      }
    }, 30000);
  });
});
