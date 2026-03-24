const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widget", {
  toggleRecording: () => ipcRenderer.send("widget:toggle-recording"),
  capture: () => ipcRenderer.send("widget:capture"),
  onStatus: (callback) => {
    ipcRenderer.on("widget:status", (_event, status) => callback(status));
  },
});
