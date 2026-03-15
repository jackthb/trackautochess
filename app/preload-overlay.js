const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  capture: () => ipcRenderer.send("overlay:capture"),
  dismiss: () => ipcRenderer.send("overlay:dismiss"),
});
