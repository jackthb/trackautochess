const { screen } = require("electron");

const OVERLAY_WIDTH = 280;
const OVERLAY_HEIGHT = 200;
const DOCK_MARGIN = 20;
const DOCK_POLL_MS = 1000;
const TOGGLE_ACCELERATORS = [
  "CommandOrControl+Shift+L",
  "CommandOrControl+Alt+L",
  "CommandOrControl+Shift+;",
];
const POSITION_FILE = "legendary-overlay-position.json";

/**
 * Admin legendary pool as a Discord-style game overlay:
 * docks to the Dota window, draggable within it, toggled with a hotkey.
 * Drag position is persisted and kept relative to Dota.
 */
function createLegendaryOverlay({
  BrowserWindow,
  ipcMain,
  path,
  fs,
  spawn,
  globalShortcut,
  channels,
  preloadPath,
  getIndexLoad,
  dacDir,
}) {
  let overlayWindow = null;
  let lastPayload = null;
  let userHidden = false;
  let clearTimer = null;
  let dockTimer = null;
  let finderProc = null;
  let finderReady = false;
  let finderBuffer = "";
  let pendingFind = null;
  let currentSize = { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT };
  let lastDotaBounds = null;
  /** @type {{ right: number, bottom: number } | null} */
  let userOffset = loadSavedOffset(path, fs, dacDir);
  let ignoringMove = false;
  let dragging = false;
  let boundAccelerator = null;
  const finderScript = path.join(__dirname, "find-dota-window-daemon.ps1");
  const positionPath = path.join(dacDir, POSITION_FILE);
  const EMPTY_PAYLOAD = { revealed: [], unrevealed: [], stateAt: null };

  function isAlive() {
    return overlayWindow && !overlayWindow.isDestroyed();
  }

  function sameBounds(a, b) {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  function saveOffset(offset) {
    if (!offset) return;
    try {
      fs.mkdirSync(dacDir, { recursive: true });
      fs.writeFileSync(positionPath, JSON.stringify(offset), "utf8");
    } catch (err) {
      console.warn("Failed to save legendary overlay position:", err);
    }
  }

  function ensureFinder() {
    if (process.platform !== "win32") return;
    if (finderProc && !finderProc.killed) return;

    finderReady = false;
    finderBuffer = "";
    finderProc = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", finderScript],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );

    finderProc.stdout.setEncoding("utf8");
    finderProc.stdout.on("data", (chunk) => {
      finderBuffer += chunk;
      let idx;
      while ((idx = finderBuffer.indexOf("\n")) >= 0) {
        const line = finderBuffer.slice(0, idx).trim();
        finderBuffer = finderBuffer.slice(idx + 1);
        if (!line) continue;
        if (line === "READY") {
          finderReady = true;
          continue;
        }
        if (!pendingFind) continue;
        const resolve = pendingFind;
        pendingFind = null;
        if (line === "NONE") {
          resolve(null);
          continue;
        }
        try {
          const bounds = JSON.parse(line);
          if (
            typeof bounds.x === "number" &&
            typeof bounds.y === "number" &&
            typeof bounds.width === "number" &&
            typeof bounds.height === "number"
          ) {
            resolve(bounds);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      }
    });

    finderProc.on("exit", () => {
      finderProc = null;
      finderReady = false;
      if (pendingFind) {
        const resolve = pendingFind;
        pendingFind = null;
        resolve(null);
      }
    });
  }

  function findDotaBounds() {
    return new Promise((resolve) => {
      if (process.platform !== "win32") {
        resolve(null);
        return;
      }
      ensureFinder();
      if (!finderProc || pendingFind) {
        resolve(null);
        return;
      }
      pendingFind = resolve;
      const tryWrite = () => {
        if (!finderProc) {
          if (pendingFind === resolve) {
            pendingFind = null;
            resolve(null);
          }
          return;
        }
        if (!finderReady) {
          setTimeout(tryWrite, 50);
          return;
        }
        try {
          finderProc.stdin.write("FIND\n");
        } catch {
          if (pendingFind === resolve) {
            pendingFind = null;
            resolve(null);
          }
        }
      };
      tryWrite();
      setTimeout(() => {
        if (pendingFind === resolve) {
          pendingFind = null;
          resolve(null);
        }
      }, 3000);
    });
  }

  function clampToDota(dota, x, y) {
    const minX = dota.x + 8;
    const minY = dota.y + 8;
    const maxX = dota.x + dota.width - currentSize.width - 8;
    const maxY = dota.y + dota.height - currentSize.height - 8;
    return {
      x: Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX))),
      y: Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY))),
    };
  }

  function placeOnDota(dota) {
    if (!isAlive() || !dota || dragging) return;
    lastDotaBounds = dota;
    const right = userOffset?.right ?? DOCK_MARGIN;
    const bottom = userOffset?.bottom ?? DOCK_MARGIN;
    const rawX = dota.x + dota.width - currentSize.width - right;
    const rawY = dota.y + dota.height - currentSize.height - bottom;
    const { x, y } = clampToDota(dota, rawX, rawY);
    ignoringMove = true;
    overlayWindow.setBounds({
      x,
      y,
      width: currentSize.width,
      height: currentSize.height,
    });
    setTimeout(() => {
      ignoringMove = false;
    }, 80);
  }

  function placeOnScreen() {
    if (!isAlive() || dragging) return;
    lastDotaBounds = null;
    const display = screen.getPrimaryDisplay();
    const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
    const x = Math.round(wx + ww - currentSize.width - DOCK_MARGIN);
    const y = Math.round(wy + wh - currentSize.height - DOCK_MARGIN);
    ignoringMove = true;
    overlayWindow.setBounds({
      x,
      y,
      width: currentSize.width,
      height: currentSize.height,
    });
    setTimeout(() => {
      ignoringMove = false;
    }, 80);
  }

  function rememberUserOffset() {
    if (!isAlive() || !lastDotaBounds || ignoringMove) return;
    const [x, y] = overlayWindow.getPosition();
    const { x: clampedX, y: clampedY } = clampToDota(lastDotaBounds, x, y);
    if (clampedX !== x || clampedY !== y) {
      ignoringMove = true;
      overlayWindow.setPosition(clampedX, clampedY);
      setTimeout(() => {
        ignoringMove = false;
      }, 80);
    }
    userOffset = {
      right: lastDotaBounds.x + lastDotaBounds.width - (clampedX + currentSize.width),
      bottom: lastDotaBounds.y + lastDotaBounds.height - (clampedY + currentSize.height),
    };
    saveOffset(userOffset);
  }

  function ensureWindow() {
    if (isAlive()) return overlayWindow;

    overlayWindow = new BrowserWindow({
      width: currentSize.width,
      height: currentSize.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      focusable: true,
      movable: true,
      hasShadow: false,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    overlayWindow.setAlwaysOnTop(true, "screen-saver");
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const { kind, target } = getIndexLoad();
    if (kind === "url") {
      overlayWindow.loadURL(`${target}${target.includes("?") ? "&" : "?"}overlay=legendary`);
    } else {
      overlayWindow.loadFile(target, { search: "?overlay=legendary" });
    }

    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlayWindow.on("will-move", () => {
      dragging = true;
    });
    overlayWindow.on("moved", () => {
      dragging = false;
      rememberUserOffset();
    });
    overlayWindow.on("closed", () => {
      overlayWindow = null;
      dragging = false;
    });

    return overlayWindow;
  }

  function sendPayload() {
    if (!isAlive() || !lastPayload) return;
    overlayWindow.webContents.send(channels.legendaryOverlay.push, lastPayload);
  }

  async function syncDock() {
    if (userHidden || !lastPayload) {
      if (isAlive() && overlayWindow.isVisible()) overlayWindow.hide();
      return;
    }
    if (dragging) return;

    const dota = await findDotaBounds();
    const wasVisible = isAlive() && overlayWindow.isVisible();
    ensureWindow();
    if (dota) {
      const dotaMoved = !sameBounds(lastDotaBounds, dota);
      if (!wasVisible || dotaMoved) {
        placeOnDota(dota);
      } else {
        lastDotaBounds = dota;
      }
    } else {
      // Still show — otherwise Ctrl+Shift+L looks dead when the finder
      // misses Dota (minimized, cold PowerShell, etc.).
      if (!wasVisible || lastDotaBounds) {
        placeOnScreen();
      }
    }
    if (!overlayWindow.isVisible()) {
      overlayWindow.showInactive();
    }
    sendPayload();
  }

  function startDockLoop() {
    if (dockTimer) return;
    ensureFinder();
    dockTimer = setInterval(() => {
      syncDock().catch(() => {});
    }, DOCK_POLL_MS);
  }

  function stopDockLoop() {
    if (!dockTimer) return;
    clearInterval(dockTimer);
    dockTimer = null;
  }

  function stopFinder() {
    if (!finderProc) return;
    try {
      finderProc.stdin.write("EXIT\n");
    } catch {
      // ignore
    }
    try {
      finderProc.kill();
    } catch {
      // ignore
    }
    finderProc = null;
    finderReady = false;
  }

  function showOverlay() {
    if (userHidden || !lastPayload) return;
    ensureWindow();
    startDockLoop();
    syncDock().catch(() => {});
  }

  function hideOverlay({ destroy = false } = {}) {
    if (!isAlive()) return;
    if (destroy) {
      overlayWindow.destroy();
      overlayWindow = null;
      return;
    }
    if (overlayWindow.isVisible()) overlayWindow.hide();
  }

  function resizeToContent(size) {
    if (!size || dragging) return;
    const width = Math.max(1, Math.round(Number(size.width) || OVERLAY_WIDTH));
    const height = Math.max(1, Math.round(Number(size.height) || OVERLAY_HEIGHT));
    if (width === currentSize.width && height === currentSize.height) return;
    currentSize = { width, height };
    if (isAlive() && lastDotaBounds) {
      placeOnDota(lastDotaBounds);
    } else if (isAlive()) {
      overlayWindow.setContentSize(width, height);
    }
  }

  function update(payload) {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }

    lastPayload = payload;
    if (!payload) {
      clearTimer = setTimeout(() => {
        clearTimer = null;
        if (!lastPayload) {
          hideOverlay({ destroy: true });
          stopDockLoop();
        }
      }, 150);
      return;
    }
    showOverlay();
  }

  function hideFromUser() {
    userHidden = true;
    // Destroy so the next show loads fresh renderer code (overlay misses Vite HMR).
    hideOverlay({ destroy: true });
  }

  function showFromUser() {
    userHidden = false;
    if (!lastPayload) lastPayload = EMPTY_PAYLOAD;
    showOverlay();
  }

  function toggleFromUser() {
    if (userHidden || !isAlive() || !overlayWindow.isVisible()) {
      showFromUser();
    } else {
      hideFromUser();
    }
  }

  function destroy() {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    unregister();
    stopDockLoop();
    stopFinder();
    lastPayload = null;
    userHidden = false;
    lastDotaBounds = null;
    dragging = false;
    if (boundAccelerator) {
      try {
        globalShortcut.unregister(boundAccelerator);
      } catch {
        // ignore
      }
      boundAccelerator = null;
    }
    if (isAlive()) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
  }

  function unregister() {
    ipcMain.removeHandler(channels.legendaryOverlay.update);
    ipcMain.removeHandler(channels.legendaryOverlay.hide);
    ipcMain.removeHandler(channels.legendaryOverlay.show);
    ipcMain.removeHandler(channels.legendaryOverlay.toggle);
    ipcMain.removeAllListeners(channels.legendaryOverlay.resize);
    ipcMain.removeAllListeners(channels.legendaryOverlay.ready);
  }

  function register() {
    // Re-registering the same channel throws; clear any prior handlers first so
    // register() is idempotent and the invoke handlers exist before any window.
    unregister();
    ipcMain.handle(channels.legendaryOverlay.update, (_event, payload) => {
      update(payload || null);
      return true;
    });
    ipcMain.handle(channels.legendaryOverlay.hide, () => {
      hideFromUser();
      return true;
    });
    ipcMain.handle(channels.legendaryOverlay.show, () => {
      showFromUser();
      return true;
    });
    ipcMain.handle(channels.legendaryOverlay.toggle, () => {
      toggleFromUser();
      return true;
    });
    ipcMain.on(channels.legendaryOverlay.resize, (_event, size) => {
      resizeToContent(size);
    });
    ipcMain.on(channels.legendaryOverlay.ready, (event) => {
      if (lastPayload && event.sender === overlayWindow?.webContents) {
        event.sender.send(channels.legendaryOverlay.push, lastPayload);
      }
    });
  }

  function registerHotkey() {
    boundAccelerator = null;
    for (const accelerator of TOGGLE_ACCELERATORS) {
      try {
        const ok = globalShortcut.register(accelerator, () => {
          toggleFromUser();
        });
        if (ok) {
          boundAccelerator = accelerator;
          console.log(`Legendary overlay hotkey: ${accelerator}`);
          break;
        }
        console.warn(`Legendary overlay hotkey unavailable: ${accelerator}`);
      } catch (err) {
        console.warn(`Failed to register ${accelerator} for legendary overlay:`, err);
      }
    }
    if (!boundAccelerator) {
      console.warn(
        "Legendary overlay: no global hotkey registered — use Settings → Toggle overlay",
      );
    }
  }

  return {
    register,
    registerHotkey,
    destroy,
    update,
    getToggleAccelerator: () => boundAccelerator || TOGGLE_ACCELERATORS[0],
  };
}

function loadSavedOffset(path, fs, dacDir) {
  try {
    const raw = fs.readFileSync(path.join(dacDir, POSITION_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.right === "number" && typeof parsed.bottom === "number") {
      return { right: parsed.right, bottom: parsed.bottom };
    }
  } catch {
    // first run / missing file
  }
  return null;
}

module.exports = { createLegendaryOverlay };
