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

contextBridge.exposeInMainWorld("lab", {
  listScreenshots: () => ipcRenderer.invoke("lab:listScreenshots"),
  loadConfig: () => ipcRenderer.invoke("lab:loadConfig"),
  saveConfig: (config) => ipcRenderer.invoke("lab:saveConfig", config),
  resetConfig: () => ipcRenderer.invoke("lab:resetConfig"),
  parseFull: (payload) => ipcRenderer.invoke("lab:parseFull", payload),
  parseRegion: (payload) => ipcRenderer.invoke("lab:parseRegion", payload),
  listFixtures: () => ipcRenderer.invoke("lab:listFixtures"),
  saveFixture: (name, data) => ipcRenderer.invoke("lab:saveFixture", name, data),
  deleteFixture: (name) => ipcRenderer.invoke("lab:deleteFixture", name),
  imageData: (filePath) => ipcRenderer.invoke("lab:imageData", filePath),
  runFixtures: () => ipcRenderer.invoke("lab:runFixtures"),
  onPytestOutput: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on("lab:pytestOutput", handler);
    return () => ipcRenderer.removeListener("lab:pytestOutput", handler);
  },
});

contextBridge.exposeInMainWorld("appApi", {
  openFileDialog: () => ipcRenderer.invoke("app:openFileDialog"),
  openGameOverScreenshotDialog: () => ipcRenderer.invoke("app:openGameOverScreenshotDialog"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
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
  fetchItems: () => ipcRenderer.invoke("data:items"),
  fetchTalents: () => ipcRenderer.invoke("data:talents"),
  fetchDrodo: () => ipcRenderer.invoke("drodo:fetch"),
  refreshDrodo: () => ipcRenderer.invoke("drodo:refresh"),
});
