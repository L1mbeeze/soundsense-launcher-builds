const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { WebSocketServer } = require('ws');
const { pathToFileURL } = require('url');
const soundSenseManager = require('./services/soundSenseManager');

const getStagepadWindowStatePath = () => path.join(app.getPath('userData'), 'stagepad-window-state.json');
const getStagepadDisplayPrefsPath = () => path.join(app.getPath("userData"), "stagepad-display-prefs.json");
const DEFAULT_STAGEPAD_COVER_FORMAT = "16:9";
const DEFAULT_STAGEPAD_DISPLAY_PREFS = {
  workDisplayId: null,
  performanceDisplayId: null,
  coverFormat: DEFAULT_STAGEPAD_COVER_FORMAT,
  updatedAt: null,
};
let stagepadCoverWindow = null;
let stagepadMixerWindow = null;
let stagepadProjectsWindow = null;
const stagepadPerformanceWindows = new Map();
let stagepadCoverProjectId = null;
let stagepadCoverOpen = false;
let updaterWindow = null;
let launcherStarted = false;
const getVideofonDisplayPrefsPath = () => path.join(app.getPath("userData"), "videofon-display-prefs.json");
const DEFAULT_VIDEFON_DISPLAY_PREFS = {
  workDisplayId: null,
  demoDisplayId: null,
  toggleHotkey: "",
  updatedAt: null,
};
let videofonDemoWindow = null;
let videofonIdleCover = null;
const getVideofonProjectsDir = () => path.join(app.getPath("userData"), "videofon-projects");

let localServerInstance = null;
let localServerClients = new Set();
let localServerPort = 0;
let localServerLastError = null;
let localHttpServer = null;
const localServerSubscribers = new Set();
let activeStagepadPerformanceProject = null;
const DEFAULT_LOCALSERVER_PORT = 17800;
const STAGEPAD_SCENE_FILE = "project.scene.json";

function getStagepadModuleRoot() {
  const runtime = path.join(__dirname, "modules", "stagepad", "1.0.0");
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "modules", "stagepad", "1.0.0")
    : null;
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, "modules", "stagepad", "1.0.0")
    : null;
  const candidates = [
    runtime,
    unpacked,
    packaged,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[candidates.length - 1];
}

function getStagepadProjectsRoot() {
  return path.join(getStagepadModuleRoot(), "projects");
}

function getLocalServerModuleRoot() {
  const runtime = path.join(__dirname, "modules", "localserver", "1.0.0");
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "modules", "localserver", "1.0.0")
    : null;
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, "modules", "localserver", "1.0.0")
    : null;
  const candidates = [
    runtime,
    unpacked,
    packaged,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[candidates.length - 1];
}

function readLocalServerRemoteHtml() {
  try {
    const filePath = path.join(getLocalServerModuleRoot(), "remote.html");
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch (error) {
    console.error("Не удалось прочитать remote.html:", error);
  }
  return "<!doctype html><meta charset=\"utf-8\"><title>Local Server</title><p>Remote UI not found.</p>";
}

function readStagepadProjectMeta(projectId) {
  if (!projectId) return null;
  try {
    const metaPath = path.join(getStagepadProjectsRoot(), projectId, "project.json");
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch (error) {
    console.error("Не удалось прочитать метаданные StagePad:", error);
    return null;
  }
}

function listStagepadProjects() {
  try {
    const projectsRoot = getStagepadProjectsRoot();
    if (!fs.existsSync(projectsRoot)) return [];
    const entries = fs.readdirSync(projectsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    return entries.map((entry) => {
      const meta = readStagepadProjectMeta(entry.name) || {};
      return {
        id: entry.name,
        name: meta.name || entry.name,
        description: meta.description || "",
        group: meta.group || "",
        updatedAt: meta.updatedAt || null,
      };
    });
  } catch (error) {
    console.error("Не удалось прочитать проекты StagePad:", error);
    return [];
  }
}

function readStagepadScene(projectId) {
  if (!projectId) return null;
  try {
    const scenePath = path.join(getStagepadProjectsRoot(), projectId, STAGEPAD_SCENE_FILE);
    if (!fs.existsSync(scenePath)) return { buttons: [], grid: null };
    const data = JSON.parse(fs.readFileSync(scenePath, "utf-8"));
    return {
      buttons: Array.isArray(data?.buttons) ? data.buttons : [],
      grid: data?.grid && typeof data.grid === "object"
        ? { rows: Number(data.grid.rows) || null, cols: Number(data.grid.cols) || null }
        : null,
    };
  } catch (error) {
    console.error("Не удалось прочитать сцену StagePad:", error);
    return { buttons: [], grid: null };
  }
}

function getLocalServerIps() {
  const results = [];
  const nets = os.networkInterfaces?.() || {};
  Object.values(nets).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4") return;
      results.push(entry.address);
    });
  });
  return Array.from(new Set(results));
}

function getLocalServerStatus() {
  const running = Boolean(localServerInstance);
  const port = running ? localServerPort : null;
  const ips = running ? getLocalServerIps() : [];
  const httpUrls = running
    ? ["http://localhost:" + port, ...ips.map((ip) => `http://${ip}:${port}`)]
    : [];
  const wsUrls = httpUrls.map((url) => url.replace(/^http/, "ws"));
  return {
    running,
    port,
    httpUrls,
    wsUrls,
    clients: localServerClients.size,
    error: localServerLastError,
  };
}

function broadcastLocalServerStatus() {
  const payload = getLocalServerStatus();
  localServerSubscribers.forEach((wc) => {
    if (!wc || wc.isDestroyed()) return;
    try {
      wc.send("localserver:status-update", payload);
    } catch (_) {
      /* ignore */
    }
  });
  broadcastWsMessage({ type: "server-status", payload });
}

function broadcastWsMessage(message) {
  if (!localServerInstance) return;
  const payload = typeof message === "string" ? message : JSON.stringify(message);
  localServerClients.forEach((client) => {
    if (!client || client.readyState !== client.OPEN) return;
    try {
      client.send(payload);
    } catch (_) {
      /* ignore */
    }
  });
}

function handleWsMessage(ws, data) {
  let payload = null;
  try {
    payload = JSON.parse(String(data));
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Неверный формат JSON" }));
    return;
  }
  const type = payload?.type;
  if (!type) {
    ws.send(JSON.stringify({ type: "error", message: "Не указан type" }));
    return;
  }
  if (type === "ping") {
    ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
    return;
  }
  if (type === "get-modules") {
    ws.send(
      JSON.stringify({
        type: "modules",
        items: [{ id: "stagepad", name: "StagePad" }],
      })
    );
    return;
  }
  if (type === "list-projects") {
    ws.send(JSON.stringify({ type: "projects", items: listStagepadProjects() }));
    return;
  }
  if (type === "launch-project") {
    const projectId = String(payload.projectId || "").trim();
    if (!projectId) {
      ws.send(JSON.stringify({ type: "error", message: "projectId обязателен" }));
      return;
    }
    openModule("stagepad", { query: { project: projectId, mode: "performance" } });
    activeStagepadPerformanceProject = projectId;
    ws.send(JSON.stringify({ type: "performance-started", projectId }));
    const scene = readStagepadScene(projectId);
    ws.send(
      JSON.stringify({
        type: "performance-buttons",
        projectId,
        grid: scene?.grid || null,
        buttons: (scene?.buttons || []).map((btn) => ({
          id: btn.id,
          label: btn.label || "Кнопка",
          color: btn.color || "#00ffa6",
          colorAlpha: typeof btn.colorAlpha === "number" ? btn.colorAlpha : 1,
          type: btn.type || "music",
          playMode: btn.playMode || "solo",
          position: typeof btn.position === "number" ? btn.position : null,
        })),
      })
    );
    return;
  }
  if (type === "get-performance") {
    const projectId = String(payload.projectId || activeStagepadPerformanceProject || "").trim();
    if (!projectId) {
      ws.send(JSON.stringify({ type: "error", message: "projectId обязателен" }));
      return;
    }
    const scene = readStagepadScene(projectId);
    ws.send(
      JSON.stringify({
        type: "performance-buttons",
        projectId,
        grid: scene?.grid || null,
        buttons: (scene?.buttons || []).map((btn) => ({
          id: btn.id,
          label: btn.label || "Кнопка",
          color: btn.color || "#00ffa6",
          colorAlpha: typeof btn.colorAlpha === "number" ? btn.colorAlpha : 1,
          type: btn.type || "music",
          playMode: btn.playMode || "solo",
          position: typeof btn.position === "number" ? btn.position : null,
        })),
      })
    );
    return;
  }
  if (type === "press-button") {
    const projectId = String(payload.projectId || activeStagepadPerformanceProject || "").trim();
    const buttonId = String(payload.buttonId || "").trim();
    if (!projectId || !buttonId) {
      ws.send(JSON.stringify({ type: "error", message: "projectId и buttonId обязательны" }));
      return;
    }
    const target = stagepadPerformanceWindows.get(projectId);
    if (!target || target.isDestroyed()) {
      ws.send(JSON.stringify({ type: "error", message: "Окно StagePad не найдено" }));
      return;
    }
    try {
      target.webContents.send("stagepad:remote-command", {
        type: "press-button",
        buttonId,
        action: payload.action || null,
      });
      ws.send(JSON.stringify({ type: "ok", action: "press-button", buttonId }));
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: "Не удалось отправить команду" }));
    }
    return;
  }
  if (type === "reset-used") {
    const projectId = String(payload.projectId || activeStagepadPerformanceProject || "").trim();
    if (!projectId) {
      ws.send(JSON.stringify({ type: "error", message: "projectId обязателен" }));
      return;
    }
    const target = stagepadPerformanceWindows.get(projectId);
    if (!target || target.isDestroyed()) {
      ws.send(JSON.stringify({ type: "error", message: "Окно StagePad не найдено" }));
      return;
    }
    try {
      target.webContents.send("stagepad:remote-command", { type: "reset-used" });
      ws.send(JSON.stringify({ type: "ok", action: "reset-used" }));
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: "Не удалось отправить команду" }));
    }
    return;
  }
  if (type === "set-mixer-group") {
    const projectId = String(payload.projectId || activeStagepadPerformanceProject || "").trim();
    const index = Number(payload.index);
    const value = payload.value;
    if (!projectId || !Number.isFinite(index)) {
      ws.send(JSON.stringify({ type: "error", message: "projectId и index обязательны" }));
      return;
    }
    const target = stagepadPerformanceWindows.get(projectId);
    if (!target || target.isDestroyed()) {
      ws.send(JSON.stringify({ type: "error", message: "Окно StagePad не найдено" }));
      return;
    }
    try {
      target.webContents.send("stagepad:remote-command", {
        type: "set-mixer-group",
        index,
        value,
      });
      ws.send(JSON.stringify({ type: "ok", action: "set-mixer-group", index }));
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: "Не удалось отправить команду" }));
    }
    return;
  }

  ws.send(JSON.stringify({ type: "error", message: `Неизвестная команда: ${type}` }));
}

function startLocalServer({ port } = {}) {
  if (localServerInstance) return getLocalServerStatus();
  const targetPort = Number(port) || DEFAULT_LOCALSERVER_PORT;
  localServerLastError = null;
  localServerPort = targetPort;
  localServerClients = new Set();
  localHttpServer = http.createServer((req, res) => {
    const url = req?.url || "/";
    if (url === "/" || url === "/index.html") {
      const body = readLocalServerRemoteHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    }
    if (url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(getLocalServerStatus()));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
  localServerInstance = new WebSocketServer({ server: localHttpServer });

  localServerInstance.on("connection", (ws) => {
    localServerClients.add(ws);
    ws.send(JSON.stringify({ type: "server-status", payload: getLocalServerStatus() }));
    ws.send(JSON.stringify({ type: "modules", items: [{ id: "stagepad", name: "StagePad" }] }));
    broadcastLocalServerStatus();
    ws.on("message", (data) => handleWsMessage(ws, data));
    ws.on("close", () => {
      localServerClients.delete(ws);
      broadcastLocalServerStatus();
    });
    ws.on("error", () => {
      localServerClients.delete(ws);
      broadcastLocalServerStatus();
    });
  });

  localServerInstance.on("error", (error) => {
    console.error("WebSocket сервер не запустился:", error);
    localServerLastError = error?.message || "Не удалось запустить сервер";
    if (error && error.code === "EADDRINUSE") {
      stopLocalServer();
    }
  });
  localHttpServer.on("error", (error) => {
    console.error("HTTP сервер не запустился:", error);
    localServerLastError = error?.message || "Не удалось запустить сервер";
    stopLocalServer();
  });
  localHttpServer.listen(targetPort, "0.0.0.0", () => {
    broadcastLocalServerStatus();
  });
  return getLocalServerStatus();
}

function stopLocalServer() {
  if (!localServerInstance) return getLocalServerStatus();
  localServerClients.forEach((client) => {
    try {
      client.close();
    } catch (_) {
      /* ignore */
    }
  });
  localServerClients.clear();
  try {
    localServerInstance.close();
  } catch (_) {
    /* ignore */
  }
  localServerInstance = null;
  if (localHttpServer) {
    try {
      localHttpServer.close();
    } catch (_) {
      /* ignore */
    }
  }
  localHttpServer = null;
  localServerPort = 0;
  localServerLastError = null;
  broadcastLocalServerStatus();
  return getLocalServerStatus();
}

function ensureVideofonProjectsDir() {
  const dir = getVideofonProjectsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function normalizeProjectId(name) {
  const base = String(name || "").trim().toLowerCase();
  const cleaned = base.replace(/[^a-z0-9а-яё_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return cleaned || "project";
}

function listVideofonProjects() {
  try {
    const dir = ensureVideofonProjectsDir();
    const files = fs.readdirSync(dir).filter((entry) => entry.toLowerCase().endsWith(".json"));
    return files.map((file) => {
      const filePath = path.join(dir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const id = path.basename(file, ".json");
        return {
          id,
          name: data?.name || id,
          updatedAt: data?.updatedAt || null,
          createdAt: data?.createdAt || null,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    console.error("Не удалось прочитать проекты VideoFon:", error);
    return [];
  }
}

function saveVideofonProject(payload) {
  if (!payload || !payload.name) return null;
  const id = normalizeProjectId(payload.name);
  const dir = ensureVideofonProjectsDir();
  const filePath = path.join(dir, `${id}.json`);
  const existing = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, "utf-8"))
    : null;
  const next = {
    id,
    name: String(payload.name || id),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data: payload.data || {},
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
  return { id: next.id, name: next.name, updatedAt: next.updatedAt, createdAt: next.createdAt };
}

function loadVideofonProject(id) {
  if (!id) return null;
  try {
    const dir = ensureVideofonProjectsDir();
    const filePath = path.join(dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data || null;
  } catch (error) {
    console.error("Не удалось загрузить проект VideoFon:", error);
    return null;
  }
}

function deleteVideofonProject(id) {
  if (!id) return false;
  try {
    const dir = ensureVideofonProjectsDir();
    const filePath = path.join(dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error("Не удалось удалить проект VideoFon:", error);
    return false;
  }
}

function renameVideofonProject(id, name) {
  if (!id || !name) return null;
  try {
    const dir = ensureVideofonProjectsDir();
    const filePath = path.join(dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const next = {
      ...data,
      name: String(name),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
    return { id, name: next.name, updatedAt: next.updatedAt, createdAt: next.createdAt || null };
  } catch (error) {
    console.error("Не удалось переименовать проект VideoFon:", error);
    return null;
  }
}

function broadcastStagepadCoverState() {
  const payload = { open: stagepadCoverOpen, projectId: stagepadCoverProjectId };
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents?.send("stagepad:cover-state", payload);
    } catch (_) {
      /* ignore */
    }
  });
}

const normalizeDisplayId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

function loadStagepadDisplayPrefs() {
  try {
    const prefsPath = getStagepadDisplayPrefsPath();
    if (!fs.existsSync(prefsPath)) return { ...DEFAULT_STAGEPAD_DISPLAY_PREFS };
    const data = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    const allowedFormats = new Set(["16:9", "4:3", "1:1", "9:16"]);
    const coverFormat = allowedFormats.has(data.coverFormat)
      ? data.coverFormat
      : DEFAULT_STAGEPAD_COVER_FORMAT;
    return {
      workDisplayId: normalizeDisplayId(data.workDisplayId),
      performanceDisplayId: normalizeDisplayId(data.performanceDisplayId),
      coverFormat,
      updatedAt: data.updatedAt || null,
    };
  } catch (error) {
    console.error("Не удалось прочитать настройки экранов StagePad:", error);
    return { ...DEFAULT_STAGEPAD_DISPLAY_PREFS };
  }
}

function saveStagepadDisplayPrefs(prefs) {
  const current = loadStagepadDisplayPrefs();
  const allowedFormats = new Set(["16:9", "4:3", "1:1", "9:16"]);
  const nextCoverFormat = allowedFormats.has(prefs?.coverFormat)
    ? prefs.coverFormat
    : current.coverFormat || DEFAULT_STAGEPAD_COVER_FORMAT;
  const next = {
    ...DEFAULT_STAGEPAD_DISPLAY_PREFS,
    ...current,
    workDisplayId: normalizeDisplayId(prefs?.workDisplayId ?? current.workDisplayId),
    performanceDisplayId: normalizeDisplayId(prefs?.performanceDisplayId ?? current.performanceDisplayId),
    coverFormat: nextCoverFormat,
    updatedAt: new Date().toISOString(),
  };
  try {
    const prefsPath = getStagepadDisplayPrefsPath();
    fs.writeFileSync(prefsPath, JSON.stringify(next, null, 2), "utf-8");
  } catch (error) {
    console.error("Не удалось сохранить настройки экранов StagePad:", error);
  }
  return next;
}

function getDisplayById(targetId) {
  if (!screen?.getAllDisplays) return null;
  const displays = screen.getAllDisplays();
  if (!displays.length) return null;
  const found = targetId ? displays.find((d) => String(d.id) === String(targetId)) : null;
  return found || displays.find((d) => d.primary) || displays[0];
}

function loadVideofonDisplayPrefs() {
  try {
    const prefsPath = getVideofonDisplayPrefsPath();
    if (!fs.existsSync(prefsPath)) return { ...DEFAULT_VIDEFON_DISPLAY_PREFS };
    const data = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    return {
      workDisplayId: normalizeDisplayId(data.workDisplayId),
      demoDisplayId: normalizeDisplayId(data.demoDisplayId),
      toggleHotkey: typeof data.toggleHotkey === "string" ? data.toggleHotkey : "",
      updatedAt: data.updatedAt || null,
    };
  } catch (error) {
    console.error("Не удалось прочитать настройки экранов VideoFon:", error);
    return { ...DEFAULT_VIDEFON_DISPLAY_PREFS };
  }
}

function saveVideofonDisplayPrefs(prefs) {
  const current = loadVideofonDisplayPrefs();
  const next = {
    ...DEFAULT_VIDEFON_DISPLAY_PREFS,
    ...current,
    workDisplayId: normalizeDisplayId(prefs?.workDisplayId ?? current.workDisplayId),
    demoDisplayId: normalizeDisplayId(prefs?.demoDisplayId ?? current.demoDisplayId),
    toggleHotkey: typeof prefs?.toggleHotkey === "string" ? prefs.toggleHotkey : (current.toggleHotkey || ""),
    updatedAt: new Date().toISOString(),
  };
  try {
    const prefsPath = getVideofonDisplayPrefsPath();
    fs.writeFileSync(prefsPath, JSON.stringify(next, null, 2), "utf-8");
  } catch (error) {
    console.error("Не удалось сохранить настройки экранов VideoFon:", error);
  }
  return next;
}

function pickVideofonDemoDisplay() {
  if (!screen?.getAllDisplays) return null;
  const displays = screen.getAllDisplays();
  if (!displays.length) return null;
  const prefs = loadVideofonDisplayPrefs();
  const preferred = prefs.demoDisplayId
    ? displays.find((d) => String(d.id) === String(prefs.demoDisplayId))
    : null;
  if (preferred) return preferred;
  if (displays.length === 1) return displays[0];
  const nonPrimary = displays.find((d) => !d.primary);
  return nonPrimary || displays[0];
}

function openVideofonDemoWindow({ showExisting = true } = {}) {
  if (videofonDemoWindow && !videofonDemoWindow.isDestroyed()) {
    if (showExisting) {
      videofonDemoWindow.showInactive();
    }
    return videofonDemoWindow;
  }
  const moduleBase = path.join(__dirname, "modules", "videofon", "1.0.0");
  const entryPath = path.join(moduleBase, "display.html");
  const preloadPath = path.join(moduleBase, "display-preload.js");
  const display = pickVideofonDemoDisplay();
  const bounds = display?.bounds || {};
  videofonDemoWindow = new BrowserWindow({
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    width: bounds.width || 1280,
    height: bounds.height || 720,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#000000",
    movable: false,
    resizable: false,
    show: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
    },
  });
  videofonDemoWindow.setAlwaysOnTop(true, "screen-saver");
  videofonDemoWindow.loadFile(entryPath);
  videofonDemoWindow.webContents.on("did-finish-load", () => {
    if (videofonIdleCover) {
      sendVideofonDisplayEvent("videofon:idle-cover", videofonIdleCover);
    }
  });
  videofonDemoWindow.once("ready-to-show", () => {
    if (videofonDemoWindow && !videofonDemoWindow.isDestroyed()) {
      videofonDemoWindow.showInactive();
    }
  });
  videofonDemoWindow.on("closed", () => {
    videofonDemoWindow = null;
  });
  return videofonDemoWindow;
}

function sendVideofonDisplayEvent(channel, payload) {
  if (!videofonDemoWindow || videofonDemoWindow.isDestroyed()) return;
  try {
    videofonDemoWindow.webContents.send(channel, payload);
  } catch (_) {
    /* ignore */
  }
}

function openStagepadCoverWindow(projectId) {
  if (stagepadCoverWindow && !stagepadCoverWindow.isDestroyed()) {
    const nextUrl = buildCoverUrl(projectId);
    if (nextUrl) {
      stagepadCoverWindow.loadURL(nextUrl);
    }
    stagepadCoverProjectId = projectId || stagepadCoverProjectId;
    stagepadCoverOpen = true;
    broadcastStagepadCoverState();
    return true;
  }
  const prefs = loadStagepadDisplayPrefs();
  const displays = screen?.getAllDisplays?.() || [];
  const workDisplay = getDisplayById(prefs.workDisplayId);
  const perfDisplay = getDisplayById(prefs.performanceDisplayId);
  const sameDisplay =
    prefs.performanceDisplayId &&
    prefs.workDisplayId &&
    String(prefs.performanceDisplayId) === String(prefs.workDisplayId);
  const useSmallWindow = displays.length <= 1 || sameDisplay;
  stagepadCoverProjectId = projectId || null;
  stagepadCoverOpen = true;
  broadcastStagepadCoverState();

  if (useSmallWindow) {
    const display = workDisplay || perfDisplay || screen?.getPrimaryDisplay?.();
    const bounds = buildStagepadWindowBounds("cover", 760, 480, display);
    stagepadCoverWindow = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: true,
      fullscreen: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      backgroundColor: "#000000",
      movable: true,
      resizable: true,
      show: true,
      focusable: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });
    attachStagepadWindowState(stagepadCoverWindow, "cover");
  } else {
    const display = perfDisplay;
    const bounds = display?.bounds || {};
    stagepadCoverWindow = new BrowserWindow({
      x: bounds.x ?? undefined,
      y: bounds.y ?? undefined,
      width: bounds.width || 800,
      height: bounds.height || 600,
      frame: false,
      fullscreen: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: "#000000",
      movable: false,
      resizable: false,
      show: false,
      focusable: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });
    stagepadCoverWindow.setAlwaysOnTop(true, "screen-saver");
  }
  const coverUrl = buildCoverUrl(projectId);
  if (coverUrl) {
    stagepadCoverWindow.loadURL(coverUrl);
  } else {
    stagepadCoverWindow.loadFile(path.join(__dirname, "modules", "stagepad", "1.0.0", "cover.html"));
  }
  stagepadCoverWindow.once("ready-to-show", () => {
    if (!useSmallWindow) {
      stagepadCoverWindow.showInactive();
    }
  });
  stagepadCoverWindow.on("closed", () => {
    stagepadCoverWindow = null;
    stagepadCoverProjectId = null;
    stagepadCoverOpen = false;
    broadcastStagepadCoverState();
  });
  return true;
}

function closeStagepadCoverWindow() {
  if (stagepadCoverWindow && !stagepadCoverWindow.isDestroyed()) {
    stagepadCoverWindow.close();
    stagepadCoverWindow = null;
    stagepadCoverProjectId = null;
    stagepadCoverOpen = false;
    broadcastStagepadCoverState();
    return true;
  }
  stagepadCoverWindow = null;
  stagepadCoverProjectId = null;
  stagepadCoverOpen = false;
  broadcastStagepadCoverState();
  return false;
}

function openStagepadMixerWindow() {
  if (stagepadMixerWindow && !stagepadMixerWindow.isDestroyed()) {
    stagepadMixerWindow.focus();
    return true;
  }
  const moduleBase = path.join(__dirname, "modules", "stagepad", "1.0.0");
  const preloadPath = path.join(moduleBase, "preload.js");
  const entryPath = path.join(moduleBase, "mixer.html");
  const hasPreload = fs.existsSync(preloadPath);
  const width = 760;
  const height = 520;
  const prefs = loadStagepadDisplayPrefs();
  const display = getDisplayById(prefs.workDisplayId);
  const bounds = buildStagepadWindowBounds("mixer", width, height, display);
  stagepadMixerWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minHeight: 320,
    x: bounds.x,
    y: bounds.y,
    resizable: true,
    alwaysOnTop: true,
    title: "StagePad — Микшер",
    backgroundColor: "#0d0f14",
    frame: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: hasPreload ? preloadPath : undefined,
    },
  });
  stagepadMixerWindow.removeMenu();
  stagepadMixerWindow.setAlwaysOnTop(true, "floating");
  stagepadMixerWindow.loadFile(entryPath);
  stagepadMixerWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    stagepadMixerWindow?.setTitle("StagePad — Микшер");
  });
  stagepadMixerWindow.on("closed", () => {
    stagepadMixerWindow = null;
  });
  attachDevtoolsHotkey(stagepadMixerWindow);
  attachStagepadWindowState(stagepadMixerWindow, "mixer");
  return true;
}

function buildCoverUrl(projectId) {
  try {
    const moduleBase = path.join(__dirname, "modules", "stagepad", "1.0.0");
    const coverPath = path.join(moduleBase, "cover.html");
    const fileUrl = pathToFileURL(coverPath);
    if (!projectId) {
      return fileUrl.toString();
    }
    const projectMetaPath = path.join(moduleBase, "projects", projectId, "project.json");
    if (!fs.existsSync(projectMetaPath)) {
      return fileUrl.toString();
    }
    const meta = JSON.parse(fs.readFileSync(projectMetaPath, "utf-8"));
    const logoRel = meta?.logoDesign || "";
    if (!logoRel) {
      return fileUrl.toString();
    }
    const projectDir = path.join(moduleBase, "projects", projectId);
    const logoPath = path.join(projectDir, logoRel);
    const baseUrl = pathToFileURL(projectDir + path.sep).toString();
    const logoUrl = pathToFileURL(logoPath).toString();
    fileUrl.searchParams.set("logo", logoUrl);
    fileUrl.searchParams.set("base", baseUrl);
    return fileUrl.toString();
  } catch (error) {
    return null;
  }
}

function checkLauncherUpdate() {
  return new Promise((resolve, reject) => {
    https.get("https://soundsense.pro/launcher/version.json", (res) => {
      let data = "";

      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const remote = JSON.parse(data);
          const pkgPath = path.join(__dirname, "package.json");
          const local =
            JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;

          resolve({
            needUpdate: remote.version !== local,
            remote,
            local,
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function attachDevtoolsHotkey(win) {
  if (!win?.webContents) return;
  win.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const key = (input.key || "").toLowerCase();
    const devtoolsCombo = key === "d" && input.control && input.shift && input.alt;
    const resetCombo =
      (key === "ъ" || key === "`" || key === "~") && input.control && input.shift && input.alt;
    if (devtoolsCombo) {
      if (!win.webContents.isDevToolsOpened()) {
        win.webContents.openDevTools({ mode: "detach" });
      }
    }
    if (resetCombo) {
      resetAllWindowsToCenter();
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 720,
    resizable: true,
    minWidth: 1200,
    minHeight: 720,
    frame: false,
    title: "SoundSense Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.removeMenu();
  win.loadFile("index.html");
  attachDevtoolsHotkey(win);
}

function createUpdaterWindow() {
  const runtime = path.join(__dirname, "updater", "1.0.0");
  const appPath = path.join(app.getAppPath(), "updater", "1.0.0");
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar", "updater", "1.0.0")
    : null;
  const candidates = [runtime, appPath, packaged].filter(Boolean);
  const updaterRoot = candidates.find((candidate) => fs.existsSync(candidate)) || runtime;

  updaterWindow = new BrowserWindow({
    width: 560,
    height: 320,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    backgroundColor: "#0d0f14",
    title: "SoundSense Updater",
    webPreferences: {
      preload: path.join(updaterRoot, "preload.js"),
    },
  });

  updaterWindow.removeMenu();
  updaterWindow.loadFile(path.join(updaterRoot, "index.html"));
  updaterWindow.on("closed", () => {
    updaterWindow = null;
    startLauncher();
  });
}

async function runLauncherUpdateCheck() {
  try {
    const update = await checkLauncherUpdate();

    if (update.needUpdate) {
      console.log("Нужна установка нового лаунчера:", update.remote.version);

      setTimeout(() => {
        const [window] = BrowserWindow.getAllWindows();
        if (window) {
          window.webContents.send("launcher-update", update);
        }
      }, 500);
    }
  } catch (error) {
    console.error("Ошибка проверки обновления лаунчера:", error);
  }
}

function startLauncher() {
  if (launcherStarted) return;
  launcherStarted = true;
  createWindow();
  runLauncherUpdateCheck();
}

function readStagepadProjectName(moduleBase, projectId) {
  try {
    const projectMetaPath = path.join(moduleBase, "projects", projectId, "project.json");
    const meta = JSON.parse(fs.readFileSync(projectMetaPath, "utf-8"));
    return meta?.name || meta?.id || null;
  } catch {
    return null;
  }
}

function loadStagepadWindowState() {
  try {
    const statePath = getStagepadWindowStatePath();
    if (!fs.existsSync(statePath)) return {};
    const data = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return typeof data === "object" && data ? data : {};
  } catch (error) {
    console.error("Не удалось прочитать размеры окон StagePad:", error);
    return {};
  }
}

function saveStagepadWindowState(state) {
  try {
    const statePath = getStagepadWindowStatePath();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    console.error("Не удалось сохранить размеры окон StagePad:", error);
  }
}

function getSavedStagepadBounds(key) {
  if (!key) return null;
  const state = loadStagepadWindowState();
  const saved = state?.[key];
  if (!saved || typeof saved !== "object") return null;
  const width = Number(saved.width);
  const height = Number(saved.height);
  const x = Number(saved.x);
  const y = Number(saved.y);
  return {
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
    x: Number.isFinite(x) ? x : undefined,
    y: Number.isFinite(y) ? y : undefined,
  };
}

function computeCenteredBounds(width, height, display) {
  const workArea = display?.workArea || display?.bounds || {};
  const targetWidth = Math.max(100, Number(width) || 0);
  const targetHeight = Math.max(100, Number(height) || 0);
  return {
    x: Math.round((workArea.x ?? 0) + Math.max(((workArea.width ?? targetWidth) - targetWidth) / 2, 0)),
    y: Math.round((workArea.y ?? 0) + Math.max(((workArea.height ?? targetHeight) - targetHeight) / 2, 0)),
  };
}

function buildStagepadWindowBounds(key, width, height, display) {
  const saved = getSavedStagepadBounds(key);
  const targetWidth = saved?.width || width;
  const targetHeight = saved?.height || height;
  if (saved?.x != null && saved?.y != null) {
    return { width: targetWidth, height: targetHeight, x: saved.x, y: saved.y };
  }
  const centered = computeCenteredBounds(targetWidth, targetHeight, display);
  return { width: targetWidth, height: targetHeight, ...centered };
}

function centerWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    const bounds = win.getBounds();
    const display = screen?.getDisplayMatching ? screen.getDisplayMatching(bounds) : screen?.getPrimaryDisplay?.();
    const centered = computeCenteredBounds(bounds.width, bounds.height, display);
    win.setBounds({ ...bounds, ...centered });
  } catch (_) {
    /* ignore */
  }
}

function attachStagepadWindowState(win, key) {
  if (!win || !key) return;
  let saveTimer = null;
  let windowClosed = false;
  const persistNow = () => {
    if (windowClosed || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const nextState = loadStagepadWindowState();
    nextState[key] = { ...nextState[key], x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    saveStagepadWindowState(nextState);
  };
  const persistSoon = () => {
    if (windowClosed || win.isDestroyed()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 150);
  };
  win.on("resize", persistSoon);
  win.on("move", persistSoon);
  win.on("unmaximize", persistSoon);
  win.on("maximize", persistSoon);
  win.on("close", () => {
    windowClosed = true;
    if (saveTimer) clearTimeout(saveTimer);
    persistNow();
  });
  win.on("closed", () => {
    windowClosed = true;
    if (saveTimer) clearTimeout(saveTimer);
  });
}

function resetAllWindowsToCenter() {
  const wins = BrowserWindow.getAllWindows();
  wins.forEach((win) => centerWindow(win));
  const state = loadStagepadWindowState();
  const updateState = (key, win) => {
    if (!key || !win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    state[key] = { ...state[key], x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  };
  updateState("projects", stagepadProjectsWindow);
  updateState("mixer", stagepadMixerWindow);
  wins.forEach((win) => {
    if (win.__moduleId !== "stagepad") return;
    const query = win.__moduleQuery || {};
    if (query.mode === "performance" && typeof query.project === "string") {
      updateState(`perf_${query.project}`, win);
    }
  });
  saveStagepadWindowState(state);
}

function openModule(moduleId, options = {}) {
  const hasQuery = options.query && Object.keys(options.query).length > 0;
  if (moduleId === "stagepad" && !hasQuery) {
    if (stagepadProjectsWindow && !stagepadProjectsWindow.isDestroyed()) {
      if (stagepadProjectsWindow.isMinimized()) stagepadProjectsWindow.restore();
      stagepadProjectsWindow.focus();
      return;
    }
  }
  if (
    moduleId === "stagepad" &&
    options.query?.mode === "performance" &&
    typeof options.query.project === "string" &&
    options.query.project
  ) {
    const targetId = options.query.project;
    const existing = stagepadPerformanceWindows.get(targetId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
  }
  const moduleBase = path.join(__dirname, "modules", moduleId, "1.0.0");
  const manifestPath = path.join(moduleBase, "manifest.json");
  const preloadPath = path.join(moduleBase, "preload.js");

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    console.error(`Не удалось прочитать manifest для модуля ${moduleId}:`, error);
    return;
  }

  const entry = manifest.entry || "index.html";
  const windowConfig = manifest.window || {};
  const entryPath = path.join(moduleBase, entry);
  const hasPreload = fs.existsSync(preloadPath);
  let resolvedTitle = windowConfig.title || manifest.name || "Module";

  if (
    moduleId === "stagepad" &&
    options.query?.mode === "performance" &&
    typeof options.query.project === "string" &&
    options.query.project
  ) {
    const projectName = readStagepadProjectName(moduleBase, options.query.project);
    if (projectName) {
      resolvedTitle = projectName;
    }
  }

  if (!fs.existsSync(entryPath)) {
    console.error(
      `Не найден entry файл ${entry} для модуля ${moduleId} в ${moduleBase}`
    );
    return;
  }

  const isStagepadPerformance =
    moduleId === "stagepad" && options.query?.mode === "performance" && typeof options.query.project === "string";
  const isStagepadProjects = moduleId === "stagepad" && !hasQuery;
  const stagepadWindowKey = isStagepadPerformance
    ? `perf_${options.query.project}`
    : isStagepadProjects
      ? "projects"
      : null;
  const savedBounds = stagepadWindowKey ? getSavedStagepadBounds(stagepadWindowKey) : null;
  const defaultWidth = windowConfig.width || 1024;
  const defaultHeight = windowConfig.height || 680;
  const initialWidth = savedBounds?.width || defaultWidth;
  const initialHeight = savedBounds?.height || defaultHeight;
  let targetDisplay = null;
  if (screen?.getAllDisplays) {
    if (moduleId === "stagepad") {
      const prefs = loadStagepadDisplayPrefs();
      // Пока отправляем все окна на рабочий экран (perf позже пойдёт в отдельное окно)
      const targetDisplayId = prefs.workDisplayId;
      const displays = screen.getAllDisplays();
      targetDisplay =
        (targetDisplayId ? displays.find((d) => String(d.id) === String(targetDisplayId)) : null) ||
        displays.find((d) => d.primary) ||
        displays[0] ||
        null;
    } else if (moduleId === "videofon") {
      const prefs = loadVideofonDisplayPrefs();
      const targetDisplayId = prefs.workDisplayId;
      const displays = screen.getAllDisplays();
      targetDisplay =
        (targetDisplayId ? displays.find((d) => String(d.id) === String(targetDisplayId)) : null) ||
        displays.find((d) => d.primary) ||
        displays[0] ||
        null;
    }
  }
  const windowBounds = stagepadWindowKey
    ? buildStagepadWindowBounds(stagepadWindowKey, initialWidth, initialHeight, targetDisplay)
    : targetDisplay && targetDisplay.bounds
      ? {
          width: initialWidth,
          height: initialHeight,
          x: Math.round(targetDisplay.bounds.x + Math.max((targetDisplay.bounds.width - initialWidth) / 2, 0)),
          y: Math.round(targetDisplay.bounds.y + Math.max((targetDisplay.bounds.height - initialHeight) / 2, 0)),
        }
      : { width: initialWidth, height: initialHeight };

  const moduleWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    resizable:
      typeof windowConfig.resizable === "boolean" ? windowConfig.resizable : true,
    title: resolvedTitle,
    backgroundColor: "#0d0f14",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: hasPreload ? preloadPath : undefined,
    },
    ...("frame" in windowConfig ? { frame: windowConfig.frame } : {}),
    ...(windowBounds.x != null ? { x: windowBounds.x } : {}),
    ...(windowBounds.y != null ? { y: windowBounds.y } : {}),
  });
  moduleWindow.__moduleId = moduleId;
  moduleWindow.__moduleQuery = hasQuery ? options.query || {} : null;
  if (moduleId === "stagepad" && !hasQuery) {
    stagepadProjectsWindow = moduleWindow;
    moduleWindow.on("closed", () => {
      if (stagepadProjectsWindow === moduleWindow) {
        stagepadProjectsWindow = null;
      }
    });
  }
  if (moduleId === "videofon") {
    moduleWindow.on("closed", () => {
      if (videofonDemoWindow && !videofonDemoWindow.isDestroyed()) {
        videofonDemoWindow.close();
      }
      videofonDemoWindow = null;
    });
  }
  if (isStagepadPerformance) {
    const projectId = options.query.project;
    stagepadPerformanceWindows.set(projectId, moduleWindow);
    activeStagepadPerformanceProject = projectId;
    if (localServerInstance) {
      const scene = readStagepadScene(projectId);
      broadcastWsMessage({ type: "performance-started", projectId });
      broadcastWsMessage({
        type: "performance-buttons",
        projectId,
        grid: scene?.grid || null,
        buttons: (scene?.buttons || []).map((btn) => ({
          id: btn.id,
          label: btn.label || "Кнопка",
          color: btn.color || "#00ffa6",
          colorAlpha: typeof btn.colorAlpha === "number" ? btn.colorAlpha : 1,
          type: btn.type || "music",
          playMode: btn.playMode || "solo",
          position: typeof btn.position === "number" ? btn.position : null,
        })),
      });
    }
    moduleWindow.on("closed", () => {
      const current = stagepadPerformanceWindows.get(projectId);
      if (current === moduleWindow) {
        stagepadPerformanceWindows.delete(projectId);
      }
      if (stagepadCoverProjectId && stagepadCoverProjectId === projectId) {
        closeStagepadCoverWindow();
      }
    });
  }

  moduleWindow.removeMenu();
  let searchString = "";
  if (options.query && typeof options.query === "object") {
    const searchParams = new URLSearchParams();
    Object.entries(options.query).forEach(([key, value]) => {
      if (value == null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => searchParams.append(key, String(item)));
      } else {
        searchParams.set(key, String(value));
      }
    });
    searchString = searchParams.toString();
  }

  const fileUrl = pathToFileURL(entryPath);
  if (searchString) {
    fileUrl.search = `?${searchString}`;
  }
  moduleWindow.loadURL(fileUrl.toString());
  moduleWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    moduleWindow.setTitle(resolvedTitle);
  });
  moduleWindow.setTitle(resolvedTitle);

  moduleWindow.webContents.setWindowOpenHandler((details) => {
    const isMixerWindow =
      details?.frameName === "stagepad-mixer" ||
      (typeof details?.url === "string" && details.url.includes("mixer.html"));
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        frame: false,
        ...(isMixerWindow ? {} : { parent: moduleWindow }),
        webPreferences: {
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          preload: hasPreload ? preloadPath : undefined,
        },
      },
    };
  });

  if (stagepadWindowKey) {
    attachStagepadWindowState(moduleWindow, stagepadWindowKey);
  }

  attachDevtoolsHotkey(moduleWindow);
}

// -------------------------
// IPC: Проверка обновлений
// -------------------------

ipcMain.on("check-updates", (event) => {
  let progress = 0;

  const interval = setInterval(() => {
    progress += 10;

    event.sender.send("progress", {
      percent: progress,
      text: `Загрузка… ${progress}%`
    });

    if (progress >= 100) {
      clearInterval(interval);
      event.sender.send("progress", {
        percent: 100,
        text: "Готово!"
      });
    }
  }, 300);
});

// -------------------------

ipcMain.handle("window:minimize", () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) window.minimize();
});

ipcMain.handle("window:toggle-maximize", () => {
  const window = BrowserWindow.getFocusedWindow();
  if (!window) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.handle("window:close", () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) window.close();
});

ipcMain.handle("window:toggle-devtools", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!window) return false;
  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools();
  } else {
    window.webContents.openDevTools({ mode: "detach" });
  }
  return true;
});

ipcMain.handle("stagepad:get-always-on-top", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window?.isAlwaysOnTop?.() ?? false;
});

ipcMain.handle("stagepad:set-always-on-top", (event, enabled) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  window.setAlwaysOnTop(Boolean(enabled));
  return window.isAlwaysOnTop();
});

ipcMain.handle("stagepad:list-displays", () => {
  if (!screen?.getAllDisplays) return [];
  const displays = screen.getAllDisplays();
  return displays.map((display, index) => ({
    id: String(display.id),
    label: display.label || display.name || `Дисплей ${index + 1}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    isPrimary: Boolean(display.primary),
    isInternal: Boolean(display.internal),
  }));
});

ipcMain.handle("stagepad:get-display-prefs", () => loadStagepadDisplayPrefs());
ipcMain.handle("stagepad:set-display-prefs", (_event, prefs) => saveStagepadDisplayPrefs(prefs || {}));
ipcMain.handle("stagepad:open-cover", (_event, projectId) => openStagepadCoverWindow(projectId));
ipcMain.handle("stagepad:close-cover", () => closeStagepadCoverWindow());
ipcMain.handle("stagepad:open-mixer", () => openStagepadMixerWindow());

ipcMain.handle("videofon:list-displays", () => {
  if (!screen?.getAllDisplays) return [];
  const displays = screen.getAllDisplays();
  return displays.map((display, index) => ({
    id: String(display.id),
    label: display.label || display.name || `Дисплей ${index + 1}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    isPrimary: Boolean(display.primary),
    isInternal: Boolean(display.internal),
  }));
});
ipcMain.handle("videofon:get-display-prefs", () => loadVideofonDisplayPrefs());
ipcMain.handle("videofon:set-display-prefs", (_event, prefs) => saveVideofonDisplayPrefs(prefs || {}));
ipcMain.handle("videofon:list-projects", () => listVideofonProjects());
ipcMain.handle("videofon:save-project", (_event, payload) => saveVideofonProject(payload || {}));
ipcMain.handle("videofon:load-project", (_event, payload) => loadVideofonProject(payload?.id));
ipcMain.handle("videofon:delete-project", (_event, payload) => deleteVideofonProject(payload?.id));
ipcMain.handle("videofon:rename-project", (_event, payload) =>
  renameVideofonProject(payload?.id, payload?.name)
);
ipcMain.handle("videofon:set-idle-cover", (_event, payload) => {
  videofonIdleCover = payload || null;
  sendVideofonDisplayEvent("videofon:idle-cover", videofonIdleCover);
  return true;
});
ipcMain.handle("videofon:open-demo", () => {
  openVideofonDemoWindow({ showExisting: true });
  return true;
});
ipcMain.handle("videofon:close-demo", () => {
  if (videofonDemoWindow && !videofonDemoWindow.isDestroyed()) {
    videofonDemoWindow.close();
    videofonDemoWindow = null;
    return true;
  }
  videofonDemoWindow = null;
  return false;
});
ipcMain.handle("videofon:toggle-demo-visibility", () => {
  const existing = videofonDemoWindow && !videofonDemoWindow.isDestroyed()
    ? videofonDemoWindow
    : null;
  const win = existing || openVideofonDemoWindow({ showExisting: false });
  if (!win) return false;
  if (win.isVisible()) {
    win.hide();
    return false;
  }
  win.showInactive();
  return true;
});
ipcMain.handle("videofon:play", (_event, payload) => {
  if (!payload?.path) return false;
  const win = openVideofonDemoWindow({ showExisting: true });
  if (!win) return false;
  const fileUrl = pathToFileURL(payload.path).toString();
  sendVideofonDisplayEvent("videofon:play", {
    url: fileUrl,
    kind: payload.kind || "video",
    duration: typeof payload.duration === "number" ? payload.duration : null,
    scaleMode: payload.scaleMode || "width",
  });
  return true;
});
ipcMain.handle("videofon:pause", () => {
  sendVideofonDisplayEvent("videofon:pause", {});
  return true;
});
ipcMain.handle("videofon:resume", () => {
  sendVideofonDisplayEvent("videofon:resume", {});
  return true;
});
ipcMain.handle("videofon:seek", (_event, payload) => {
  if (!payload || typeof payload.time !== "number") return false;
  sendVideofonDisplayEvent("videofon:seek", { time: payload.time });
  return true;
});
ipcMain.handle("videofon:set-scale", (_event, payload) => {
  const mode = payload?.mode === "width" ? "width" : "height";
  sendVideofonDisplayEvent("videofon:scale", { mode });
  return true;
});
ipcMain.handle("videofon:stop", () => {
  sendVideofonDisplayEvent("videofon:stop", {});
  return true;
});
ipcMain.handle("videofon:pick-videos", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Видео и фото", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "jpg", "jpeg", "png", "webp", "avif", "gif"] },
      { name: "Видео", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] },
      { name: "Изображения", extensions: ["jpg", "jpeg", "png", "webp", "avif", "gif"] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths || [];
});

ipcMain.handle("localserver:start", (_event, payload) => {
  try {
    return { ok: true, status: startLocalServer(payload || {}) };
  } catch (error) {
    return { ok: false, error: error?.message || "Не удалось запустить сервер" };
  }
});
ipcMain.handle("localserver:stop", () => {
  try {
    return { ok: true, status: stopLocalServer() };
  } catch (error) {
    return { ok: false, error: error?.message || "Не удалось остановить сервер" };
  }
});
ipcMain.handle("localserver:status", () => getLocalServerStatus());
ipcMain.on("localserver:subscribe", (event) => {
  const wc = event.sender;
  if (!wc) return;
  localServerSubscribers.add(wc);
  try {
    wc.send("localserver:status-update", getLocalServerStatus());
  } catch (_) {
    /* ignore */
  }
  wc.once("destroyed", () => localServerSubscribers.delete(wc));
});

ipcMain.handle("soundsense:get-state", async () => {
  return soundSenseManager.getSoundSenseState();
});

ipcMain.handle("soundsense:install", async (event) => {
  await soundSenseManager.installSoundSense({
    onProgress: (payload) =>
      event.sender.send("soundsense:progress", payload),
  });
  return soundSenseManager.getSoundSenseState();
});

ipcMain.handle("soundsense:check", async (event) => {
  await soundSenseManager.checkIntegrity({
    onProgress: (payload) =>
      event.sender.send("soundsense:progress", payload),
  });
  return soundSenseManager.getSoundSenseState();
});

ipcMain.handle("soundsense:launch", async (event) => {
  const result = await soundSenseManager.launchSoundSense({
    onProgress: (payload) =>
      event.sender.send("soundsense:progress", payload),
  });
  return {
    ...result,
    state: await soundSenseManager.getSoundSenseState(),
  };
});

ipcMain.handle("soundsense:open-folder", async () => {
  const dir = await soundSenseManager.openSoundSenseFolder();
  return { dir };
});

ipcMain.handle("soundsense:delete", async (event) => {
  await soundSenseManager.deleteSoundSense({
    onProgress: (payload) =>
      event.sender.send("soundsense:progress", payload),
  });
  return soundSenseManager.getSoundSenseState();
});

ipcMain.handle("modules:launch", (_event, moduleId) => {
  if (!moduleId) return;
  openModule(moduleId);
});

ipcMain.handle("modules:launch-with-query", (_event, payload) => {
  if (!payload?.moduleId) return;
  openModule(payload.moduleId, { query: payload.query || {} });
});

ipcMain.on("stagepad:music-play", (event, payload) => {
  const sender = event.sender;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win.webContents !== sender) {
      win.webContents.send("stagepad:stop-music-global", payload);
    }
  });
});

ipcMain.on("stagepad:remote-state", (_event, payload) => {
  if (!payload) return;
  broadcastWsMessage({ type: "performance-state", payload });
});

ipcMain.on("videofon:ended", () => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send("videofon:ended");
    } catch (_) {
      /* ignore */
    }
  });
});

ipcMain.on("videofon:time", (_event, payload) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send("videofon:time", payload);
    } catch (_) {
      /* ignore */
    }
  });
});

ipcMain.on("updater:done", () => {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.close();
  } else {
    startLauncher();
  }
});

app.whenReady().then(async () => {
  createUpdaterWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && launcherStarted) app.quit();
});
