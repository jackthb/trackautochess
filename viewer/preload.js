const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("replays", {
  list: () => ipcRenderer.invoke("replays:list"),
  delete: (filename) => ipcRenderer.invoke("replays:delete", filename),
  stats: () => ipcRenderer.invoke("replays:stats"),
  openFolder: () => ipcRenderer.invoke("replays:openFolder"),
});
