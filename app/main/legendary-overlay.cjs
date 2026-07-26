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

/**
 * Admin legendary pool as a Discord-style game overlay: locked to a fixed
 * corner of the Dota window, click-through, and only visible while Dota is the
 * foreground window. Toggled with a hotkey.
 */
function createLegendaryOverlay({
  BrowserWindow,
  ipcMain,
  path,
  spawn,
  globalShortcut,
  channels,
  preloadPath,
  getIndexLoad,
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
  let ignoringMove = false;
  let boundAccelerator = null;
  const finderScript = path.join(__dirname, "find-dota-window-daemon.ps1");
  const EMPTY_PAYLOAD = { revealed: [], unrevealed: [], stateAt: null };

  function isAlive() {
    return overlayWindow && !overlayWindow.isDestroyed();
  }

  function sameBounds(a, b) {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
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
    if (!isAlive() || !dota) return;
    lastDotaBounds = dota;
    // Pinned to the top-right corner of the Dota window — not user-movable.
    const rawX = dota.x + dota.width - currentSize.width - DOCK_MARGIN;
    const rawY = dota.y + DOCK_MARGIN;
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
      focusable: false,
      movable: false,
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
    // Display-only overlay: let every click fall through to Dota so it can never
    // steal focus or get in the way.
    overlayWindow.setIgnoreMouseEvents(true);

    const { kind, target } = getIndexLoad();
    if (kind === "url") {
      overlayWindow.loadURL(`${target}${target.includes("?") ? "&" : "?"}overlay=legendary`);
    } else {
      overlayWindow.loadFile(target, { search: "?overlay=legendary" });
    }

    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlayWindow.on("closed", () => {
      overlayWindow = null;
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

    // The finder only reports bounds while Dota is the foreground window; a null
    // result means the user is looking at something else, so hide rather than
    // leaving the overlay floating over the desktop.
    const dotaPhysical = await findDotaBounds();
    if (!dotaPhysical) {
      lastDotaBounds = null;
      if (isAlive() && overlayWindow.isVisible()) overlayWindow.hide();
      return;
    }

    // The finder reports Win32 GetWindowRect bounds in physical pixels; Electron's
    // setBounds works in DIPs. On any display not at 100% scaling those disagree, so
    // convert to DIPs here to keep the overlay pinned to the Dota window.
    const dota =
      process.platform === "win32"
        ? screen.screenToDipRect(null, dotaPhysical)
        : dotaPhysical;
    const wasVisible = isAlive() && overlayWindow.isVisible();
    ensureWindow();
    if (!wasVisible || !sameBounds(lastDotaBounds, dota)) {
      placeOnDota(dota);
    } else {
      lastDotaBounds = dota;
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
    if (!size) return;
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

module.exports = { createLegendaryOverlay };
