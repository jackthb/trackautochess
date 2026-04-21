const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("calibration", {
  listScreenshots: (ar) => ipcRenderer.invoke("calibration:listScreenshots", ar),
  getScreenshot: (filePath) => ipcRenderer.invoke("calibration:getScreenshot", filePath),
  loadConfig: () => ipcRenderer.invoke("calibration:loadConfig"),
  saveConfig: (config) => ipcRenderer.invoke("calibration:saveConfig", config),
  runViewDebug: (payload) => ipcRenderer.invoke("calibration:debugView", payload),
});

contextBridge.exposeInMainWorld("windowControls", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
});
