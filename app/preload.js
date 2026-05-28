const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("replays", {
  list: () => ipcRenderer.invoke("replays:list"),
  delete: (filename) => ipcRenderer.invoke("replays:delete", filename),
  stats: () => ipcRenderer.invoke("replays:stats"),
  openFolder: () => ipcRenderer.invoke("replays:openFolder"),
  exists: (filename) => ipcRenderer.invoke("replays:exists", filename),
});

contextBridge.exposeInMainWorld("tracker", {
  sendCommand: (cmd) => ipcRenderer.send("tracker:command", cmd),
  onEvent: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on("tracker:event", handler);
    return () => ipcRenderer.removeListener("tracker:event", handler);
  },
});

contextBridge.exposeInMainWorld("trackerLog", {
  read: () => ipcRenderer.invoke("trackerLog:read"),
  onUpdate: (callback) => {
    const handler = (_event, entries) => callback(entries);
    ipcRenderer.on("trackerLog:update", handler);
    return () => ipcRenderer.removeListener("trackerLog:update", handler);
  },
});

contextBridge.exposeInMainWorld("windowControls", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
});

contextBridge.exposeInMainWorld("appApi", {
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  fetchGames: () => ipcRenderer.invoke("games:fetch"),
  fetchTimeline: (matchId) => ipcRenderer.invoke("timelines:fetch", matchId),
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
