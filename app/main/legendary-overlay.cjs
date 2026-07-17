const { screen } = require("electron");

const OVERLAY_WIDTH = 280;
const OVERLAY_HEIGHT = 200;
const SCREEN_MARGIN = 16;

/**
 * Admin legendary pool as a Discord-styled always-on-top overlay window.
 */
function createLegendaryOverlay({
  BrowserWindow,
  ipcMain,
  path,
  channels,
  preloadPath,
  getIndexLoad,
}) {
  let overlayWindow = null;
  let lastPayload = null;
  let userHidden = false;
  let clearTimer = null;
  let currentSize = { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT };
  /** @type {{ x: number, y: number } | null} */
  let savedPosition = null;

  function isAlive() {
    return overlayWindow && !overlayWindow.isDestroyed();
  }

  function defaultPosition() {
    const display = screen.getPrimaryDisplay();
    const work = display.workArea;
    return {
      x: Math.round(work.x + work.width - currentSize.width - SCREEN_MARGIN),
      y: Math.round(work.y + work.height - currentSize.height - SCREEN_MARGIN),
    };
  }

  function rememberPosition() {
    if (!isAlive()) return;
    const [x, y] = overlayWindow.getPosition();
    savedPosition = { x, y };
  }

  function applyPosition() {
    if (!isAlive()) return;
    const pos = savedPosition || defaultPosition();
    overlayWindow.setPosition(pos.x, pos.y);
  }

  function ensureWindow() {
    if (isAlive()) return overlayWindow;

    const pos = savedPosition || defaultPosition();
    overlayWindow = new BrowserWindow({
      width: currentSize.width,
      height: currentSize.height,
      x: pos.x,
      y: pos.y,
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
    overlayWindow.on("moved", rememberPosition);
    overlayWindow.on("closed", () => {
      overlayWindow = null;
    });

    return overlayWindow;
  }

  function sendPayload() {
    if (!isAlive() || !lastPayload) return;
    overlayWindow.webContents.send(channels.legendaryOverlay.push, lastPayload);
  }

  function showOverlay() {
    if (userHidden || !lastPayload) return;
    ensureWindow();
    if (!overlayWindow.isVisible()) {
      applyPosition();
      overlayWindow.showInactive();
    }
    sendPayload();
  }

  function hideOverlay() {
    if (!isAlive()) return;
    rememberPosition();
    if (overlayWindow.isVisible()) overlayWindow.hide();
  }

  function resizeToContent(size) {
    if (!isAlive() || !size) return;
    const width = Math.max(200, Math.round(Number(size.width) || OVERLAY_WIDTH));
    const height = Math.max(80, Math.round(Number(size.height) || OVERLAY_HEIGHT));
    if (width === currentSize.width && height === currentSize.height) return;
    currentSize = { width, height };
    // setSize only — never setBounds, which was snapping the window back.
    overlayWindow.setSize(width, height);
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
        if (!lastPayload) hideOverlay();
      }, 150);
      return;
    }
    showOverlay();
  }

  function hideFromUser() {
    userHidden = true;
    hideOverlay();
  }

  function showFromUser() {
    userHidden = false;
    if (lastPayload) showOverlay();
  }

  function destroy() {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    lastPayload = null;
    userHidden = false;
    if (isAlive()) {
      rememberPosition();
      overlayWindow.destroy();
      overlayWindow = null;
    }
  }

  function register() {
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
    ipcMain.on(channels.legendaryOverlay.resize, (_event, size) => {
      resizeToContent(size);
    });
    ipcMain.on(channels.legendaryOverlay.ready, (event) => {
      if (lastPayload && event.sender === overlayWindow?.webContents) {
        event.sender.send(channels.legendaryOverlay.push, lastPayload);
      }
    });
  }

  return { register, destroy, update };
}

module.exports = { createLegendaryOverlay };
