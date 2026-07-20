const { contextBridge, ipcRenderer } = require("electron");

// TODO: Generate this and ipc-channels.cjs from one source. Sandboxed Electron
// preload scripts cannot require sibling project modules directly.
const CHANNELS = {
  app: {
    openExternal: "app:openExternal",
    getVersion: "app:getVersion",
  },
  data: {
    units: "data:units",
    unitsFull: "data:units_full",
    synergies: "data:synergies",
    relics: "data:relics",
    items: "data:items",
    itemsFull: "data:items_full",
    itemLinks: "data:item_links",
    talents: "data:talents",
  },
  replays: {
    list: "replays:list",
    delete: "replays:delete",
    stats: "replays:stats",
    openFolder: "replays:openFolder",
    exists: "replays:exists",
  },
  tracker: {
    command: "tracker:command",
    event: "tracker:event",
  },
  trackerLog: {
    read: "trackerLog:read",
    paths: "trackerLog:paths",
    update: "trackerLog:update",
  },
  window: {
    minimize: "window:minimize",
    maximize: "window:maximize",
    close: "window:close",
  },
  legendaryOverlay: {
    update: "legendaryOverlay:update",
    hide: "legendaryOverlay:hide",
    show: "legendaryOverlay:show",
    toggle: "legendaryOverlay:toggle",
    ready: "legendaryOverlay:ready",
    push: "legendaryOverlay:push",
    resize: "legendaryOverlay:resize",
  },
};

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
  fetchItemLinks: () => ipcRenderer.invoke(CHANNELS.data.itemLinks),
  fetchTalents: () => ipcRenderer.invoke(CHANNELS.data.talents),
});

contextBridge.exposeInMainWorld("legendaryOverlay", {
  update: (payload) => ipcRenderer.invoke(CHANNELS.legendaryOverlay.update, payload),
  hide: () => ipcRenderer.invoke(CHANNELS.legendaryOverlay.hide),
  show: () => ipcRenderer.invoke(CHANNELS.legendaryOverlay.show),
  toggle: () => ipcRenderer.invoke(CHANNELS.legendaryOverlay.toggle),
  ready: () => ipcRenderer.send(CHANNELS.legendaryOverlay.ready),
  resize: (size) => ipcRenderer.send(CHANNELS.legendaryOverlay.resize, size),
  onPush: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(CHANNELS.legendaryOverlay.push, handler);
    return () => ipcRenderer.removeListener(CHANNELS.legendaryOverlay.push, handler);
  },
});
