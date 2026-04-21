const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("replays", {
  list: () => ipcRenderer.invoke("replays:list"),
  delete: (filename) => ipcRenderer.invoke("replays:delete", filename),
  stats: () => ipcRenderer.invoke("replays:stats"),
  openFolder: () => ipcRenderer.invoke("replays:openFolder"),
  exists: (filename) => ipcRenderer.invoke("replays:exists", filename),
});

contextBridge.exposeInMainWorld("screenshots", {
  list: () => ipcRenderer.invoke("screenshots:list"),
  delete: (filename) => ipcRenderer.invoke("screenshots:delete", filename),
  openFolder: () => ipcRenderer.invoke("screenshots:openFolder"),
  thumbnail: (filename) => ipcRenderer.invoke("screenshots:thumbnail", filename),
  canAccessDebug: () => ipcRenderer.invoke("screenshots:canAccessDebug"),
  debug: (filename, screenType) => ipcRenderer.invoke("screenshots:debug", filename, screenType),
  getParseResult: (filename) => ipcRenderer.invoke("screenshots:getParseResult", filename),
  updateParseRow: (filename, rowIndex, fields) => ipcRenderer.invoke("screenshots:updateParseRow", filename, rowIndex, fields),
});

contextBridge.exposeInMainWorld("tracker", {
  sendCommand: (cmd) => ipcRenderer.send("tracker:command", cmd),
  onEvent: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on("tracker:event", handler);
    return () => ipcRenderer.removeListener("tracker:event", handler);
  },
});

contextBridge.exposeInMainWorld("windowControls", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
});

contextBridge.exposeInMainWorld("appApi", {
  openFileDialog: () => ipcRenderer.invoke("app:openFileDialog"),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getCloseToTray: () => ipcRenderer.invoke("app:getCloseToTray"),
  setCloseToTray: (value) => ipcRenderer.invoke("app:setCloseToTray", value),
  fetchGames: () => ipcRenderer.invoke("games:fetch"),
  updateGame: (gameId, fields) => ipcRenderer.invoke("games:update", gameId, fields),
  deleteGame: (gameId) => ipcRenderer.invoke("games:delete", gameId),
  fetchUnitsData: () => ipcRenderer.invoke("data:units"),
  fetchUnitsFull: () => ipcRenderer.invoke("data:units_full"),
  fetchSynergies: () => ipcRenderer.invoke("data:synergies"),
  fetchRelics: () => ipcRenderer.invoke("data:relics"),
  openCalibration: () => ipcRenderer.invoke("app:openCalibration"),
  fetchDrodo: () => ipcRenderer.invoke("drodo:fetch"),
  refreshDrodo: () => ipcRenderer.invoke("drodo:refresh"),
});
