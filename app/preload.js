const { contextBridge, ipcRenderer } = require("electron");
const { CHANNELS } = require("./ipc-channels.cjs");

contextBridge.exposeInMainWorld("replays", {
  list: () => ipcRenderer.invoke(CHANNELS.replays.list),
  delete: (filename) => ipcRenderer.invoke(CHANNELS.replays.delete, filename),
  stats: () => ipcRenderer.invoke(CHANNELS.replays.stats),
  openFolder: () => ipcRenderer.invoke(CHANNELS.replays.openFolder),
  exists: (filename) => ipcRenderer.invoke(CHANNELS.replays.exists, filename),
});

contextBridge.exposeInMainWorld("tracker", {
  sendCommand: (cmd) => ipcRenderer.send(CHANNELS.tracker.command, cmd),
  onEvent: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on(CHANNELS.tracker.event, handler);
    return () => ipcRenderer.removeListener(CHANNELS.tracker.event, handler);
  },
});

contextBridge.exposeInMainWorld("trackerLog", {
  read: () => ipcRenderer.invoke(CHANNELS.trackerLog.read),
  paths: () => ipcRenderer.invoke(CHANNELS.trackerLog.paths),
  onUpdate: (callback) => {
    const handler = (_event, entries) => callback(entries);
    ipcRenderer.on(CHANNELS.trackerLog.update, handler);
    return () => ipcRenderer.removeListener(CHANNELS.trackerLog.update, handler);
  },
});

contextBridge.exposeInMainWorld("windowControls", {
  minimize: () => ipcRenderer.send(CHANNELS.window.minimize),
  maximize: () => ipcRenderer.send(CHANNELS.window.maximize),
  close: () => ipcRenderer.send(CHANNELS.window.close),
});

contextBridge.exposeInMainWorld("appApi", {
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.app.openExternal, url),
  getVersion: () => ipcRenderer.invoke(CHANNELS.app.getVersion),
  fetchUnitsData: () => ipcRenderer.invoke(CHANNELS.data.units),
  fetchUnitsFull: () => ipcRenderer.invoke(CHANNELS.data.unitsFull),
  fetchSynergies: () => ipcRenderer.invoke(CHANNELS.data.synergies),
  fetchRelics: () => ipcRenderer.invoke(CHANNELS.data.relics),
  fetchItems: () => ipcRenderer.invoke(CHANNELS.data.items),
  fetchItemsFull: () => ipcRenderer.invoke(CHANNELS.data.itemsFull),
  fetchTalents: () => ipcRenderer.invoke(CHANNELS.data.talents),
});
