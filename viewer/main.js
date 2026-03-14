const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  Tray,
  Menu,
  Notification,
  globalShortcut,
  dialog,
  nativeImage,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const readline = require("readline");

const DAC_DIR = path.join(os.homedir(), ".dac");
const REPLAY_DIR = path.join(DAC_DIR, "replays");
const TRACKER_DIR = path.join(__dirname, "..", "tracker");
const ICONS_DIR = path.join(__dirname, "..", "data", "icons");

// Ensure dirs exist
for (const dir of [DAC_DIR, REPLAY_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let pythonProcess = null;
let pythonRL = null;
let overlayTimeout = null;
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

function getPythonPath() {
  if (process.platform === "win32") {
    return path.join(TRACKER_DIR, ".venv", "Scripts", "python.exe");
  }
  return path.join(TRACKER_DIR, ".venv", "bin", "python");
}

function startPython() {
  const pythonPath = getPythonPath();
  const scriptPath = path.join(TRACKER_DIR, "headless.py");

  if (!fs.existsSync(pythonPath)) {
    console.error(`Python not found at ${pythonPath}`);
    return;
  }

  console.log(`Starting Python: ${pythonPath} ${scriptPath}`);

  pythonProcess = spawn(pythonPath, [scriptPath], {
    cwd: TRACKER_DIR,
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
    console.error("Python process not running");
    return;
  }
  const line = JSON.stringify(cmd) + "\n";
  pythonProcess.stdin.write(line);
}

function handlePythonEvent(msg) {
  // Forward all events to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tracker:event", msg);
  }

  switch (msg.type) {
    case "status":
      trackerStatus = { ...trackerStatus, ...msg };
      updateTrayMenu();
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
      updateTrayMenu();
      break;

    case "replay_started":
      trackerStatus.recording = true;
      updateTrayMenu();
      break;

    case "replay_saved":
      trackerStatus.recording = false;
      updateTrayMenu();
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

// ── System tray ──────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(ICONS_DIR, "dac_tracker.ico");
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // Fallback: 16x16 green square
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("DAC Tracker");

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const loginLabel = trackerStatus.steam_name
    ? `Signed in: ${trackerStatus.steam_name}`
    : "Login with Steam";

  const contextMenu = Menu.buildFromTemplate([
    {
      label: loginLabel,
      enabled: !trackerStatus.logged_in,
      click: () => sendToPython({ cmd: "steam_login" }),
    },
    {
      label: "Logout",
      visible: trackerStatus.logged_in,
      click: () => sendToPython({ cmd: "steam_logout" }),
    },
    { type: "separator" },
    {
      label: "Import History Screenshot...",
      click: async () => {
        const result = await dialog.showOpenDialog({
          title: "Select MY MATCHES screenshot",
          filters: [
            { name: "Images", extensions: ["jpg", "jpeg", "png"] },
            { name: "All files", extensions: ["*"] },
          ],
        });
        if (!result.canceled && result.filePaths.length > 0) {
          sendToPython({ cmd: "import_file", path: result.filePaths[0] });
        }
      },
    },
    {
      label: "Record Replays",
      type: "checkbox",
      checked: trackerStatus.replay_enabled,
      click: (item) => {
        sendToPython({
          cmd: "set_config",
          key: "replay_enabled",
          value: item.checked,
        });
      },
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        sendToPython({ cmd: "quit" });
        setTimeout(() => app.quit(), 1500);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Main window ──────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#08090b",
    titleBarStyle: "hiddenInset",
    titleBarOverlay: {
      color: "#08090b",
      symbolColor: "#6b7080",
      height: 36,
    },
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

  // Hide instead of close (tray keeps running)
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
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
}

// ── Tracker IPC (renderer → main → Python) ──────────────────────────────────

ipcMain.on("tracker:command", (_event, cmd) => {
  sendToPython(cmd);
});

ipcMain.handle("app:openFileDialog", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select MY MATCHES screenshot",
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
      `${url}/rest/v1/games?user_id=eq.${steamId}&order=played_at.desc&limit=100`,
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

// ── Units data IPC ───────────────────────────────────────────────────────────

ipcMain.handle("data:units", async () => {
  const unitsPath = path.join(__dirname, "..", "data", "units.json");
  if (!fs.existsSync(unitsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(unitsPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Synergies data IPC ────────────────────────────────────────────────────────

ipcMain.handle("data:synergies", async () => {
  const synPath = path.join(__dirname, "..", "data", "synergies.json");
  if (!fs.existsSync(synPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(synPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Relics data IPC ──────────────────────────────────────────────────────────

ipcMain.handle("data:relics", async () => {
  const relicPath = path.join(__dirname, "..", "data", "relics.json");
  if (!fs.existsSync(relicPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(relicPath, "utf-8"));
  } catch {
    return {};
  }
});

// ── Full units data IPC ──────────────────────────────────────────────────────

ipcMain.handle("data:units_full", async () => {
  const fullPath = path.join(__dirname, "..", "data", "units_full.json");
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
]);

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Handle replay:// protocol
  protocol.handle("replay", (request) => {
    const filename = decodeURIComponent(
      request.url.replace("replay://video/", "")
    );
    const filePath = path.join(REPLAY_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(`file://${filePath}`);
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
  createTray();
  registerShortcuts();
  startPython();

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();

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
  // Don't quit — tray keeps running
});

// ── Replay IPC handlers (unchanged) ─────────────────────────────────────────

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
