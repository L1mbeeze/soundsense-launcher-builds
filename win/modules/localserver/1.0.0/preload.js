const { contextBridge, ipcRenderer } = require("electron");
const QRCode = require("qrcode");

contextBridge.exposeInMainWorld("localServerAPI", {
  start: (options) => ipcRenderer.invoke("localserver:start", options || {}),
  stop: () => ipcRenderer.invoke("localserver:stop"),
  getStatus: () => ipcRenderer.invoke("localserver:status"),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback?.(payload);
    ipcRenderer.on("localserver:status-update", handler);
    ipcRenderer.send("localserver:subscribe");
    return () => ipcRenderer.removeListener("localserver:status-update", handler);
  },
  makeQrDataUrl: (text) =>
    QRCode.toDataURL(String(text || ""), {
      margin: 1,
      width: 200,
      color: { dark: "#0f172a", light: "#ffffff" },
    }),
});
