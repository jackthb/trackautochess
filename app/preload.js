const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("replays", {
  list: () => ipcRenderer.invoke("replays:list"),
  delete: (filename) => ipcRenderer.invoke("replays:delete", filename),
  stats: () => ipcRenderer.invoke("replays:stats"),
  openFolder: () => ipcRenderer.invoke("replays:openFolder"),
});

contextBridge.exposeInMainWorld("tracker", {
  sendCommand: (cmd) => ipcRenderer.send("tracker:command", cmd),
  onEvent: (callback) => {
    ipcRenderer.on("tracker:event", (_event, msg) => callback(msg));
  },
});

contextBridge.exposeInMainWorld("appApi", {
  openFileDialog: () => ipcRenderer.invoke("app:openFileDialog"),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  fetchGames: () => ipcRenderer.invoke("games:fetch"),
  updateGame: (gameId, fields) => ipcRenderer.invoke("games:update", gameId, fields),
  deleteGame: (gameId) => ipcRenderer.invoke("games:delete", gameId),
  fetchUnitsData: () => ipcRenderer.invoke("data:units"),
  fetchUnitsFull: () => ipcRenderer.invoke("data:units_full"),
  fetchSynergies: () => ipcRenderer.invoke("data:synergies"),
  fetchRelics: () => ipcRenderer.invoke("data:relics"),
});
