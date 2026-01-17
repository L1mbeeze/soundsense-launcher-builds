const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
  },
});

contextBridge.exposeInMainWorld("videofonAPI", {
  listDisplays: () => ipcRenderer.invoke("videofon:list-displays"),
  getDisplayPreferences: () => ipcRenderer.invoke("videofon:get-display-prefs"),
  saveDisplayPreferences: (prefs) => ipcRenderer.invoke("videofon:set-display-prefs", prefs || {}),
  listProjects: () => ipcRenderer.invoke("videofon:list-projects"),
  saveProject: (payload) => ipcRenderer.invoke("videofon:save-project", payload || {}),
  loadProject: (id) => ipcRenderer.invoke("videofon:load-project", { id }),
  deleteProject: (id) => ipcRenderer.invoke("videofon:delete-project", { id }),
  renameProject: (id, name) => ipcRenderer.invoke("videofon:rename-project", { id, name }),
  setIdleCover: (payload) => ipcRenderer.invoke("videofon:set-idle-cover", payload || null),
  openDemo: () => ipcRenderer.invoke("videofon:open-demo"),
  closeDemo: () => ipcRenderer.invoke("videofon:close-demo"),
  toggleDemoVisibility: () => ipcRenderer.invoke("videofon:toggle-demo-visibility"),
  playVideo: (filePath, options) =>
    ipcRenderer.invoke("videofon:play", { path: filePath, ...options }),
  pauseVideo: () => ipcRenderer.invoke("videofon:pause"),
  resumeVideo: () => ipcRenderer.invoke("videofon:resume"),
  seekVideo: (timeSeconds) => ipcRenderer.invoke("videofon:seek", { time: timeSeconds }),
  setScaleMode: (mode) => ipcRenderer.invoke("videofon:set-scale", { mode }),
  stopVideo: () => ipcRenderer.invoke("videofon:stop"),
  pickVideos: () => ipcRenderer.invoke("videofon:pick-videos"),
  onEnded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("videofon:ended", handler);
    return () => ipcRenderer.removeListener("videofon:ended", handler);
  },
  onTime: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("videofon:time", handler);
    return () => ipcRenderer.removeListener("videofon:time", handler);
  },
});
