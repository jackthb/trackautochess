const { app, BrowserWindow, ipcMain, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPLAY_DIR = path.join(os.homedir(), ".dac", "replays");

// Ensure replay dir exists
if (!fs.existsSync(REPLAY_DIR)) {
  fs.mkdirSync(REPLAY_DIR, { recursive: true });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0a0c10",
    titleBarStyle: "hiddenInset",
    titleBarOverlay: {
      color: "#0a0c10",
      symbolColor: "#6b7080",
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile("index.html");

  if (process.argv.includes("--dev")) {
    win.webContents.openDevTools();
  }
}

// Register custom protocol to serve replay video files
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
]);

app.whenReady().then(() => {
  // Handle replay:// protocol for serving local video files
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC handlers ──────────────────────────────────────────────────────────

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
  // Prevent path traversal
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
