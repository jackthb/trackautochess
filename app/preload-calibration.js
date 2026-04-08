const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("calibration", {
  listScreenshots: (ar) => ipcRenderer.invoke("calibration:listScreenshots", ar),
  getScreenshot: (filePath) => ipcRenderer.invoke("calibration:getScreenshot", filePath),
  loadConfig: () => ipcRenderer.invoke("calibration:loadConfig"),
  saveConfig: (config) => ipcRenderer.invoke("calibration:saveConfig", config),
  runDebug: (screenshotPath) => ipcRenderer.invoke("calibration:runDebug", screenshotPath),
  runSentinelTest: (screenshotPath, region) => ipcRenderer.invoke("calibration:sentinelTest", screenshotPath, region),
});

contextBridge.exposeInMainWorld("windowControls", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
});
