const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("videofonDisplayAPI", {
  onPlay: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("videofon:play", handler);
    return () => ipcRenderer.removeListener("videofon:play", handler);
  },
  onStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("videofon:stop", handler);
    return () => ipcRenderer.removeListener("videofon:stop", handler);
  },
  onPause: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("videofon:pause", handler);
    return () => ipcRenderer.removeListener("videofon:pause", handler);
  },
  onResume: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("videofon:resume", handler);
    return () => ipcRenderer.removeListener("videofon:resume", handler);
  },
  onSeek: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("videofon:seek", handler);
    return () => ipcRenderer.removeListener("videofon:seek", handler);
  },
  onScale: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("videofon:scale", handler);
    return () => ipcRenderer.removeListener("videofon:scale", handler);
  },
  onIdleCover: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("videofon:idle-cover", handler);
    return () => ipcRenderer.removeListener("videofon:idle-cover", handler);
  },
  sendTime: (payload) => ipcRenderer.send("videofon:time", payload),
  notifyEnded: () => ipcRenderer.send("videofon:ended"),
});
