const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notifications", {
  dismiss: (id) => ipcRenderer.send("notification:dismiss", id),
  onUpdate: (callback) => {
    const handler = (_event, items) => callback(items);
    ipcRenderer.on("notification:update", handler);
    return () => ipcRenderer.removeListener("notification:update", handler);
  },
});
