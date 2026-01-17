const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  checkUpdates: () => ipcRenderer.send("check-updates"),
  updateProgress: (callback) => ipcRenderer.on("progress", (event, data) => {
    callback(data.percent, data.text);
  }),
  onLauncherUpdate: (callback) =>
    ipcRenderer.on("launcher-update", (event, data) => callback(data)),
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
  },
});

const allowedInvokeChannels = new Set(["modules:launch"]);

contextBridge.exposeInMainWorld("api", {
  invoke: (channel, ...args) => {
    if (!allowedInvokeChannels.has(channel)) {
      return Promise.reject(new Error("Недоступный канал IPC"));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});

contextBridge.exposeInMainWorld("soundSenseAPI", {
  getState: () => ipcRenderer.invoke("soundsense:get-state"),
  install: () => ipcRenderer.invoke("soundsense:install"),
  checkIntegrity: () => ipcRenderer.invoke("soundsense:check"),
  launch: () => ipcRenderer.invoke("soundsense:launch"),
  openFolder: () => ipcRenderer.invoke("soundsense:open-folder"),
  deleteGame: () => ipcRenderer.invoke("soundsense:delete"),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("soundsense:progress", handler);
    return () => ipcRenderer.removeListener("soundsense:progress", handler);
  },
});
