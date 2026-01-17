const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const os = require("os");

const moduleRoot = __dirname;
const writableRoot = moduleRoot.includes("app.asar")
  ? path.join(process.resourcesPath, "app.asar.unpacked", "modules", "stagepad", "1.0.0")
  : moduleRoot;
const projectsRoot = path.join(writableRoot, "projects");
const templatesRoot = path.join(writableRoot, "templates");
const SCENE_FILE = "project.scene.json";
const AUDIO_EXTS = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".wma",
  ".aiff",
  ".aif",
  ".alac",
  ".opus",
]);

function ensureProjectsDir() {
  if (!fs.existsSync(projectsRoot)) {
    fs.mkdirSync(projectsRoot, { recursive: true });
  }
}

function ensureTemplatesDir() {
  if (!fs.existsSync(templatesRoot)) {
    fs.mkdirSync(templatesRoot, { recursive: true });
  }
}

function slugifyName(name = "") {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validateName(name) {
  const slug = slugifyName(name);
  if (!name || !name.trim()) {
    throw new Error("Введите название проекта");
  }
  if (!slug) {
    throw new Error("Название может содержать буквы/цифры, пробелы заменятся на _");
  }
  if (slug.length > 64) {
    throw new Error("Слишком длинное имя проекта");
  }
  return slug;
}

function sanitizeFilename(name = "asset") {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^\p{L}\p{N}._-]/gu, "")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "asset"
  );
}

function getProjectDir(id) {
  ensureProjectsDir();
  const projectDir = path.join(projectsRoot, id);
  if (!fs.existsSync(projectDir)) {
    throw new Error("Проект не найден");
  }
  return projectDir;
}

function getScenePath(projectDir) {
  return path.join(projectDir, SCENE_FILE);
}

const CLICK_ACTIONS = new Set(["restart", "pause", "stop", "open-playlist"]);

function normalizeGroupValue(group) {
  return typeof group === "string" ? group.trim() : "";
}

function normalizeClickAction(action, fallback) {
  return CLICK_ACTIONS.has(action) ? action : fallback;
}

function readProjectMeta(dirPath, id) {
  const metaPath = path.join(dirPath, "project.json");
  let meta = {
    id,
    name: id,
    description: "",
    instruction: "",
    group: "",
    perfFontSize: 18,
    perfPreloadEnabled: false,
    perfClickMiddleAction: "restart",
    perfClickRightAction: "open-playlist",
    coverImage: "",
    coverFit: "cover",
    coverPosition: "center",
    logoDesign: "",
  };
  try {
    if (fs.existsSync(metaPath)) {
      const data = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      meta = {
        ...meta,
        ...data,
        id: data.id || id,
        instruction: typeof data.instruction === "string" ? data.instruction : meta.instruction,
        group: normalizeGroupValue(data.group ?? meta.group),
        perfFontSize: Math.max(10, Math.min(32, Number(data.perfFontSize) || 18)),
        perfPreloadEnabled: Boolean(data.perfPreloadEnabled),
        perfClickMiddleAction: normalizeClickAction(data.perfClickMiddleAction, meta.perfClickMiddleAction),
        perfClickRightAction: normalizeClickAction(data.perfClickRightAction, meta.perfClickRightAction),
        coverImage: typeof data.coverImage === "string" ? data.coverImage : meta.coverImage,
        coverFit: typeof data.coverFit === "string" ? data.coverFit : meta.coverFit,
        coverPosition: typeof data.coverPosition === "string" ? data.coverPosition : meta.coverPosition,
        logoDesign: typeof data.logoDesign === "string" ? data.logoDesign : meta.logoDesign,
      };
    }
  } catch (error) {
    // Логируем, но не ломаем список
    console.error(`Не удалось прочитать метаданные проекта ${id}:`, error);
  }
  return meta;
}

function writeProjectMeta(dirPath, meta) {
  const metaPath = path.join(dirPath, "project.json");
  const payload = {
    id: meta.id,
    name: meta.name,
    description: meta.description || "",
    instruction: typeof meta.instruction === "string" ? meta.instruction : "",
    group: normalizeGroupValue(meta.group),
    perfFontSize: Math.max(10, Math.min(32, Number(meta.perfFontSize) || 18)),
    perfPreloadEnabled: Boolean(meta.perfPreloadEnabled),
    perfClickMiddleAction: normalizeClickAction(meta.perfClickMiddleAction, "restart"),
    perfClickRightAction: normalizeClickAction(meta.perfClickRightAction, "open-playlist"),
    coverImage: typeof meta.coverImage === "string" ? meta.coverImage : "",
    coverFit: typeof meta.coverFit === "string" ? meta.coverFit : "cover",
    coverPosition: typeof meta.coverPosition === "string" ? meta.coverPosition : "center",
    logoDesign: typeof meta.logoDesign === "string" ? meta.logoDesign : "",
    updatedAt: new Date().toISOString(),
    createdAt: meta.createdAt || new Date().toISOString(),
  };
  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), "utf-8");
}

function listProjects() {
  ensureProjectsDir();
  const entries = fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  return entries.map((entry) => {
    const projectDir = path.join(projectsRoot, entry.name);
    return readProjectMeta(projectDir, entry.name);
  });
}

function createProject({ name, description, group, instruction, coverFit, coverPosition, coverImage }) {
  ensureProjectsDir();
  const slug = validateName(name);
  const projectDir = path.join(projectsRoot, slug);

  if (fs.existsSync(projectDir)) {
    throw new Error("Проект с таким именем уже существует");
  }

  fs.mkdirSync(projectDir);
  writeProjectMeta(projectDir, {
    id: slug,
    name: name.trim(),
    description: description?.trim() || "",
    instruction: typeof instruction === "string" ? instruction : "",
    group: normalizeGroupValue(group),
    perfFontSize: 18,
    perfPreloadEnabled: false,
    perfClickMiddleAction: "restart",
    perfClickRightAction: "pause",
    coverImage: typeof coverImage === "string" ? coverImage : "",
    coverFit: typeof coverFit === "string" ? coverFit : "cover",
    coverPosition: typeof coverPosition === "string" ? coverPosition : "center",
    createdAt: new Date().toISOString(),
  });

  return readProjectMeta(projectDir, slug);
}

function updateProject(id, { name, description, group, instruction, coverImage, coverFit, coverPosition }) {
  ensureProjectsDir();
  const currentDir = path.join(projectsRoot, id);
  if (!fs.existsSync(currentDir)) {
    throw new Error("Проект не найден");
  }

  const newSlug = validateName(name);
  const targetDir = path.join(projectsRoot, newSlug);
  if (newSlug !== id && fs.existsSync(targetDir)) {
    throw new Error("Проект с таким именем уже существует");
  }

  const meta = readProjectMeta(currentDir, id);
  meta.name = name.trim();
  meta.description = description?.trim() || "";
  meta.instruction = typeof instruction === "string" ? instruction : meta.instruction || "";
  meta.group = normalizeGroupValue(group ?? meta.group);
  if (typeof coverImage === "string") meta.coverImage = coverImage;
  if (typeof coverFit === "string") meta.coverFit = coverFit;
  if (typeof coverPosition === "string") meta.coverPosition = coverPosition;

  if (newSlug !== id) {
    fs.renameSync(currentDir, targetDir);
  }

  writeProjectMeta(targetDir, { ...meta, id: newSlug });
  return readProjectMeta(targetDir, newSlug);
}

function setProjectPerfFontSize(projectId, fontSize) {
  const projectDir = getProjectDir(projectId);
  const meta = readProjectMeta(projectDir, projectId);
  meta.perfFontSize = Math.max(10, Math.min(32, Number(fontSize) || meta.perfFontSize || 18));
  writeProjectMeta(projectDir, meta);
  return readProjectMeta(projectDir, projectId);
}

function setProjectPreloadEnabled(projectId, enabled) {
  const projectDir = getProjectDir(projectId);
  const meta = readProjectMeta(projectDir, projectId);
  meta.perfPreloadEnabled = Boolean(enabled);
  writeProjectMeta(projectDir, meta);
  return readProjectMeta(projectDir, projectId);
}

function setProjectClickActions(projectId, { middle, right } = {}) {
  const projectDir = getProjectDir(projectId);
  const meta = readProjectMeta(projectDir, projectId);
  if (middle != null) {
    meta.perfClickMiddleAction = normalizeClickAction(middle, meta.perfClickMiddleAction);
  }
  if (right != null) {
    meta.perfClickRightAction = normalizeClickAction(right, meta.perfClickRightAction);
  }
  writeProjectMeta(projectDir, meta);
  return readProjectMeta(projectDir, projectId);
}

function saveProjectCover(projectId, fileName, arrayBuffer, { fit = "cover", position = "center" } = {}) {
  if (!projectId) throw new Error("Проект не выбран");
  if (!arrayBuffer || !fileName) throw new Error("Файл картинки не выбран");
  const projectDir = getProjectDir(projectId);
  const coverDir = path.join(projectDir, "cover");
  ensureDir(coverDir);
  const parsed = path.parse(fileName);
  const safeBase = sanitizeFilename(parsed.name || "cover");
  const ext = parsed.ext || ".png";
  const fname = uniqueName(coverDir, safeBase, ext);
  const targetPath = path.join(coverDir, fname);
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(targetPath, buffer);

  const meta = readProjectMeta(projectDir, projectId);
  meta.coverImage = path.relative(projectDir, targetPath);
  meta.coverFit = typeof fit === "string" ? fit : meta.coverFit;
  meta.coverPosition = typeof position === "string" ? position : meta.coverPosition;
  writeProjectMeta(projectDir, meta);
  return readProjectMeta(projectDir, projectId);
}

function saveProjectLogo(projectId, payload) {
  if (!projectId) throw new Error("Проект не выбран");
  const projectDir = getProjectDir(projectId);
  const logoDir = path.join(projectDir, "logo");
  ensureDir(logoDir);
  const targetPath = path.join(logoDir, "logo.json");
  fs.writeFileSync(targetPath, JSON.stringify(payload || {}, null, 2), "utf-8");
  const meta = readProjectMeta(projectDir, projectId);
  meta.logoDesign = path.relative(projectDir, targetPath).replace(/\\/g, "/");
  writeProjectMeta(projectDir, meta);
  return readProjectMeta(projectDir, projectId);
}

function deleteProject(id) {
  ensureProjectsDir();
  const projectDir = path.join(projectsRoot, id);
  if (!fs.existsSync(projectDir)) {
    throw new Error("Проект не найден");
  }
  fs.rmSync(projectDir, { recursive: true, force: true });
}

function getProjectMeta(projectId) {
  const projectDir = getProjectDir(projectId);
  return readProjectMeta(projectDir, projectId);
}

function loadScene(projectId) {
  const projectDir = getProjectDir(projectId);
  const scenePath = getScenePath(projectDir);
  if (!fs.existsSync(scenePath)) {
    return { buttons: [], grid: null };
  }
  try {
    const data = JSON.parse(fs.readFileSync(scenePath, "utf-8"));
    if (!data || typeof data !== "object") throw new Error("Bad scene");
    if (!Array.isArray(data.buttons)) data.buttons = [];
    const grid =
      data.grid && typeof data.grid === "object"
        ? { rows: Number(data.grid.rows) || null, cols: Number(data.grid.cols) || null }
        : null;
    return { buttons: data.buttons, grid };
  } catch (error) {
    console.error(`Не удалось прочитать сцену для ${projectId}:`, error);
    return { buttons: [], grid: null };
  }
}

function saveScene(projectId, scene) {
  const projectDir = getProjectDir(projectId);
  const scenePath = getScenePath(projectDir);
  const payload = {
    buttons: Array.isArray(scene?.buttons) ? scene.buttons : [],
    grid: scene?.grid || null,
  };
  fs.writeFileSync(scenePath, JSON.stringify(payload, null, 2), "utf-8");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function importAsset(projectId, sourcePath, subDir = "assets", customName = null) {
  if (!sourcePath) throw new Error("Файл не выбран");
  const projectDir = getProjectDir(projectId);
  const targetDir = path.join(projectDir, subDir);
  ensureDir(targetDir);

  const parsed = path.parse(sourcePath);
  const safeName = sanitizeFilename(customName ? path.parse(customName).name : parsed.name || "asset");
  const ext = customName ? path.parse(customName).ext || parsed.ext || "" : parsed.ext || "";
  let candidate = `${safeName}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(targetDir, candidate)) && counter < 1000) {
    candidate = `${safeName}_${counter}${ext}`;
    counter += 1;
  }

  const targetPath = path.join(targetDir, candidate);
  fs.copyFileSync(sourcePath, targetPath);
  return path.relative(projectDir, targetPath);
}

function importAssetFromBuffer(projectId, fileName, arrayBuffer, subDir = "assets") {
  if (!arrayBuffer || !fileName) throw new Error("Файл не выбран");
  const projectDir = getProjectDir(projectId);
  const targetDir = path.join(projectDir, subDir);
  ensureDir(targetDir);

  const parsed = path.parse(fileName);
  const safeName = sanitizeFilename(parsed.name || "asset");
  const ext = parsed.ext || "";
  let candidate = `${safeName}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(targetDir, candidate)) && counter < 1000) {
    candidate = `${safeName}_${counter}${ext}`;
    counter += 1;
  }
  const targetPath = path.join(targetDir, candidate);
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(targetPath, buffer);
  return path.relative(projectDir, targetPath);
}

function writeTempFile(fileName, arrayBuffer) {
  const safeName = sanitizeFilename(fileName || `temp_${Date.now()}.dat`);
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stagepad-")), safeName);
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

function copyProjectAsset(sourceProjectId, targetProjectId, relativePath) {
  if (!relativePath) throw new Error("Путь к файлу не указан");
  const srcDir = getProjectDir(sourceProjectId);
  const dstDir = getProjectDir(targetProjectId);
  const rel = normalizeRel(relativePath);
  const src = path.join(srcDir, rel);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    throw new Error("Файл для переноса не найден");
  }
  const parsed = path.parse(rel);
  const subDir = parsed.dir || "assets";
  const dstSubDir = path.join(dstDir, subDir);
  ensureDir(dstSubDir);
  const safeBase = sanitizeFilename(parsed.name || "asset");
  const fname = uniqueName(dstSubDir, safeBase, parsed.ext || "");
  const dest = path.join(dstSubDir, fname);
  fs.copyFileSync(src, dest);
  return normalizeRel(path.relative(dstDir, dest));
}

function getAssetFileUrl(projectId, relativePath) {
  const projectDir = getProjectDir(projectId);
  const normalizeRelPath = (p) => (p || "").replace(/\\/g, "/").replace(/^\.?\//, "");
  let rel = normalizeRelPath(relativePath);
  let absolutePath = path.join(projectDir, rel);
  if (!fs.existsSync(absolutePath) && rel.includes("audio/audio")) {
    rel = rel.replace(/audio\/audio\/?/, "audio/");
    absolutePath = path.join(projectDir, rel);
  }
  return pathToFileURL(absolutePath).href;
}

function uniqueName(dir, baseName, ext) {
  let candidate = `${baseName}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate)) && counter < 1000) {
    candidate = `${baseName}_${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

function saveTemplate(projectId, templateName, button) {
  if (!projectId || !button) throw new Error("Нет данных для сохранения шаблона");
  ensureTemplatesDir();
  const projectDir = getProjectDir(projectId);
  const slug = sanitizeFilename(templateName || "template");
  const folderName = slug || `template_${Date.now()}`;
  const templateDir = path.join(templatesRoot, folderName);
  if (fs.existsSync(templateDir)) {
    fs.rmSync(templateDir, { recursive: true, force: true });
  }
  fs.mkdirSync(templateDir, { recursive: true });
  const audioDir = path.join(templateDir, "audio");
  ensureDir(audioDir);

  const copyTrack = (track) => {
    if (!track?.file) return { ...track };
    const src = path.join(projectDir, track.file);
    if (!fs.existsSync(src)) return { ...track, file: "" };
    const parsed = path.parse(src);
    const safeBase = sanitizeFilename(parsed.name || "track");
    const fname = uniqueName(audioDir, safeBase || "track", parsed.ext || "");
    const dest = path.join(audioDir, fname);
    fs.copyFileSync(src, dest);
    return { ...track, file: path.join("audio", fname), normalizedFile: "", useNormalized: false };
  };

  const cleanButton = {
    ...button,
    id: "",
    position: null,
    tracks: Array.isArray(button.tracks) ? button.tracks.map(copyTrack) : [],
    file: "",
  };

  const payload = {
    id: folderName,
    name: templateName || folderName,
    createdAt: new Date().toISOString(),
    button: cleanButton,
  };
  fs.writeFileSync(path.join(templateDir, "template.json"), JSON.stringify(payload, null, 2), "utf-8");
  return { id: folderName, name: payload.name };
}

function listTemplates() {
  ensureTemplatesDir();
  const entries = fs.readdirSync(templatesRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  const result = [];
  entries.forEach((entry) => {
    const tplPath = path.join(templatesRoot, entry.name, "template.json");
    if (!fs.existsSync(tplPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(tplPath, "utf-8"));
      result.push({
        id: data.id || entry.name,
        name: data.name || entry.name,
        createdAt: data.createdAt,
        hasTracks: Array.isArray(data.button?.tracks) ? data.button.tracks.length : 0,
      });
    } catch (error) {
      // ignore broken template
    }
  });
  return result;
}

function applyTemplate(projectId, templateId) {
  if (!projectId || !templateId) throw new Error("Нет данных для применения шаблона");
  const tplPath = path.join(templatesRoot, templateId, "template.json");
  if (!fs.existsSync(tplPath)) throw new Error("Шаблон не найден");
  const tplDir = path.dirname(tplPath);
  const projectDir = getProjectDir(projectId);
  const data = JSON.parse(fs.readFileSync(tplPath, "utf-8"));
  const btn = data.button;
  if (!btn) throw new Error("Пустой шаблон");

  const destAudioDir = path.join(projectDir, "audio");
  ensureDir(destAudioDir);

  const copyTrackToProject = (track) => {
    if (!track?.file) return { ...track };
    const src = path.join(tplDir, track.file);
    if (!fs.existsSync(src)) return { ...track, file: "" };
    const parsed = path.parse(src);
    const safeBase = sanitizeFilename(parsed.name || "track");
    const fname = uniqueName(destAudioDir, safeBase || "track", parsed.ext || "");
    const dest = path.join(destAudioDir, fname);
    fs.copyFileSync(src, dest);
    return {
      ...track,
      id: `track_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file: path.join("audio", fname),
      normalizedFile: "",
      useNormalized: false,
    };
  };

  const newButton = {
    ...btn,
    id: `btn_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    position: null,
    tracks: Array.isArray(btn.tracks) ? btn.tracks.map(copyTrackToProject) : [],
    file: "",
  };
  return newButton;
}

function normalizeRel(p) {
  return (p || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function listProjectAudio(projectId) {
  const projectDir = getProjectDir(projectId);
  const result = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
      const abs = path.join(dir, entry.name);
      const rel = normalizeRel(path.relative(projectDir, abs));
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          result.push(rel);
        }
      }
    });
  };
  walk(projectDir);
  return result;
}

function findUnusedAudio(projectId, usedRelative = []) {
  const used = new Set();
  usedRelative.forEach((p) => {
    const norm = normalizeRel(p);
    if (!norm) return;
    used.add(norm);
    used.add(norm.toLowerCase());
  });
  return listProjectAudio(projectId).filter((rel) => {
    const norm = normalizeRel(rel);
    if (!norm) return false;
    return !used.has(norm) && !used.has(norm.toLowerCase());
  });
}

function deleteProjectFiles(projectId, relativeFiles = []) {
  const projectDir = getProjectDir(projectId);
  const removed = [];
  relativeFiles.forEach((rel) => {
    const norm = normalizeRel(rel);
    const abs = path.join(projectDir, norm);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      fs.unlinkSync(abs);
      removed.push(norm);
    }
  });
  return removed;
}

function resolveFfmpegPath() {
  const baseDir = moduleRoot;
  const unpackedDir = moduleRoot.includes("app.asar")
    ? moduleRoot.replace("app.asar", path.join("app.asar.unpacked"))
    : moduleRoot;
  const launcherRoot = path.resolve(moduleRoot, "..", "..", "..");
  const launcherFfmpegDir = path.join(launcherRoot, "ffmpeg");
  const cwdFfmpegDir = path.join(process.cwd(), "ffmpeg");
  const resourcesDir = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "modules", "stagepad", "1.0.0")
    : null;
  const externalModulesDir = process.resourcesPath
    ? path.join(process.resourcesPath, "modules", "stagepad", "1.0.0")
    : null;

  const dirs = [
    launcherFfmpegDir,
    cwdFfmpegDir,
    path.join(baseDir, "ffmpeg"),
    path.join(unpackedDir, "ffmpeg"),
    resourcesDir ? path.join(resourcesDir, "ffmpeg") : null,
    externalModulesDir ? path.join(externalModulesDir, "ffmpeg") : null,
  ].filter(Boolean);
  const platform = process.platform;
  const candidates = [];
  dirs.forEach((ffmpegDir) => {
    if (platform === "win32") {
      candidates.push(path.join(ffmpegDir, "win", "ffmpeg.exe"), path.join(ffmpegDir, "ffmpeg.exe"));
    } else if (platform === "darwin") {
      candidates.push(path.join(ffmpegDir, "mac", "ffmpeg"), path.join(ffmpegDir, "macos", "ffmpeg"), path.join(ffmpegDir, "ffmpeg"));
    } else {
      candidates.push(path.join(ffmpegDir, "linux", "ffmpeg"), path.join(ffmpegDir, "ffmpeg"));
    }
  });
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error("FFmpeg не найден в папке модуля (ffmpeg). Добавьте бинарь для текущей платформы.");
  }
  try {
    fs.chmodSync(found, 0o755);
  } catch (error) {
    // игнорируем, если нет прав — spawn может и так сработать
  }
  return found;
}

function buildFfmpegArgs(sourcePath, targetPath, format, option, bitrate, trimStart, trimEnd) {
  const args = ["-y"];
  if (typeof trimStart === "number" && trimStart >= 0) {
    args.push("-ss", `${trimStart}`);
  }
  args.push("-i", sourcePath);
  if (typeof trimEnd === "number" && trimEnd > 0) {
    args.push("-to", `${trimEnd}`);
  }
  switch (format) {
    case "mp3": {
      args.push("-codec:a", "libmp3lame");
      const br =
        bitrate ||
        (typeof option === "string" && option.startsWith("mp3_") ? Number(option.split("_")[1]) : undefined) ||
        192;
      args.push("-b:a", `${br}k`);
      break;
    }
    case "ogg": {
      args.push("-codec:a", "libvorbis");
      const q =
        option && option.startsWith("ogg_q") ? Number(option.replace("ogg_q", "")) : Math.max(0, Math.min(10, 6));
      args.push("-q:a", `${q}`);
      break;
    }
    case "flac": {
      args.push("-codec:a", "flac");
      const level = option && option.startsWith("flac") ? Number(option.replace("flac", "")) : 5;
      args.push("-compression_level", `${Math.max(0, Math.min(12, level || 5))}`);
      break;
    }
    case "wav": {
      if (option === "pcm24") {
        args.push("-acodec", "pcm_s24le");
      } else {
        args.push("-acodec", "pcm_s16le");
      }
      break;
    }
    default:
      break;
  }
  args.push(targetPath);
  return args;
}

function buildNormalizeArgs(sourcePath, targetPath, ext, targetI) {
  const args = ["-y", "-i", sourcePath, "-af", `loudnorm=I=${targetI}:TP=-1.5:LRA=11`];
  switch ((ext || "").toLowerCase()) {
    case ".mp3":
      args.push("-codec:a", "libmp3lame", "-b:a", "192k");
      break;
    case ".ogg":
      args.push("-codec:a", "libvorbis", "-q:a", "6");
      break;
    case ".flac":
      args.push("-codec:a", "flac", "-compression_level", "5");
      break;
    case ".wav":
      args.push("-acodec", "pcm_s16le");
      break;
    default:
      break;
  }
  args.push(targetPath);
  return args;
}

function convertAudio(
  sourcePath,
  { projectId, targetDir = "assets", targetName, format, option, bitrate, trimStart, trimEnd } = {}
) {
  if (!sourcePath) throw new Error("Путь к исходному файлу не указан");
  if (!projectId) throw new Error("Проект не выбран");
  const projectDir = getProjectDir(projectId);
  const outputDir = path.join(projectDir, targetDir || "assets");
  ensureDir(outputDir);

  const fmt = format || path.extname(targetName || sourcePath).replace(".", "") || "wav";
  const parsedTarget = path.parse(targetName || sourcePath);
  const ext = fmt ? `.${fmt}` : parsedTarget.ext || ".wav";
  const base = sanitizeFilename(parsedTarget.name || "output");
  let candidate = `${base}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(outputDir, candidate)) && counter < 1000) {
    candidate = `${base}_${counter}${ext}`;
    counter += 1;
  }
  const targetPath = path.join(outputDir, candidate);

  const ffmpegArgs = buildFfmpegArgs(
    sourcePath,
    targetPath,
    fmt,
    option,
    bitrate,
    typeof trimStart === "number" ? trimStart : undefined,
    typeof trimEnd === "number" ? trimEnd : undefined
  );
  return new Promise((resolve, reject) => {
    let ffmpegBin;
    try {
      ffmpegBin = resolveFfmpegPath();
    } catch (err) {
      return reject(err);
    }
    const ff = spawn(ffmpegBin, ffmpegArgs, { windowsHide: true });
    let stderr = "";
    ff.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ff.on("error", (err) => {
      reject(new Error(`Не удалось запустить ffmpeg: ${err.message}`));
    });
    ff.on("close", (code) => {
      if (code === 0 && fs.existsSync(targetPath)) {
        resolve(path.relative(projectDir, targetPath));
      } else {
        reject(new Error(stderr || "Ошибка конвертации ffmpeg"));
      }
    });
  });
}

function normalizeAudio(projectId, relativePath, { targetI = -14 } = {}) {
  if (!projectId) throw new Error("Проект не выбран");
  if (!relativePath) throw new Error("Файл не выбран");
  const projectDir = getProjectDir(projectId);
  const rel = normalizeRel(relativePath);
  const sourcePath = path.join(projectDir, rel);
  if (!fs.existsSync(sourcePath)) {
    throw new Error("Файл для нормализации не найден");
  }
  const parsed = path.parse(rel);
  const targetDir = path.join(projectDir, parsed.dir || "");
  ensureDir(targetDir);
  const safeBase = sanitizeFilename(`${parsed.name || "track"}_norm`);
  const ext = parsed.ext || ".wav";
  const fname = uniqueName(targetDir, safeBase, ext);
  const targetPath = path.join(targetDir, fname);
  const ffmpegArgs = buildNormalizeArgs(sourcePath, targetPath, ext, targetI);
  return new Promise((resolve, reject) => {
    let ffmpegBin;
    try {
      ffmpegBin = resolveFfmpegPath();
    } catch (err) {
      return reject(err);
    }
    const ff = spawn(ffmpegBin, ffmpegArgs, { windowsHide: true });
    let stderr = "";
    ff.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ff.on("error", (err) => {
      reject(new Error(`Не удалось запустить ffmpeg: ${err.message}`));
    });
    ff.on("close", (code) => {
      if (code === 0 && fs.existsSync(targetPath)) {
        resolve(normalizeRel(path.relative(projectDir, targetPath)));
      } else {
        reject(new Error(stderr || "Ошибка нормализации ffmpeg"));
      }
    });
  });
}

function parseLoudnormOutput(text) {
  if (!text) return null;
  const matches = Array.from(text.matchAll(/\{[\s\S]*?\}/g));
  if (!matches.length) return null;
  const jsonStr = matches[matches.length - 1][0];
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function analyzeLoudness(sourcePath, { trimStart, trimEnd, targetI = -14 } = {}) {
  if (!sourcePath) throw new Error("Путь к файлу не указан");
  console.info("[stagepad][loudness] analyze start", {
    file: path.basename(sourcePath || ""),
    targetI,
    trimStart: typeof trimStart === "number" ? trimStart : null,
    trimEnd: typeof trimEnd === "number" ? trimEnd : null,
  });
  const args = ["-hide_banner", "-nostats"];
  if (typeof trimStart === "number" && trimStart >= 0) {
    args.push("-ss", `${trimStart}`);
  }
  args.push("-i", sourcePath);
  if (typeof trimEnd === "number" && trimEnd > 0) {
    args.push("-to", `${trimEnd}`);
  }
  args.push("-af", `loudnorm=I=${targetI}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-");
  return new Promise((resolve, reject) => {
    let ffmpegBin;
    try {
      ffmpegBin = resolveFfmpegPath();
    } catch (err) {
      return reject(err);
    }
    const ff = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = "";
    ff.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ff.on("error", (err) => {
      reject(new Error(`Не удалось запустить ffmpeg: ${err.message}`));
    });
    ff.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || "Ошибка анализа громкости"));
      }
      const parsed = parseLoudnormOutput(stderr);
      if (!parsed) {
        return reject(new Error("Не удалось разобрать результат анализа громкости"));
      }
      const inputI = Number(parsed.input_i);
      const targetOffset = Number(parsed.target_offset);
      const targetIValue = Number(targetI);
      let gainDb = null;
      if (Number.isFinite(inputI) && Number.isFinite(targetIValue)) {
        gainDb = targetIValue - inputI;
      } else if (Number.isFinite(targetOffset)) {
        gainDb = targetOffset;
      }
      if (!Number.isFinite(gainDb)) {
        gainDb = 0;
      }
      console.info("[stagepad][loudness] analyze result", {
        file: path.basename(sourcePath || ""),
        inputI: Number.isFinite(inputI) ? inputI : null,
        targetI: Number(targetI),
        targetOffset: Number.isFinite(targetOffset) ? targetOffset : null,
        gainDb,
      });
      resolve({
        inputI: Number.isFinite(inputI) ? inputI : null,
        targetI: Number(targetI),
        gainDb: Number.isFinite(gainDb) ? gainDb : 0,
      });
    });
  });
}

const windowControls = {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  toggleDevTools: () => ipcRenderer.invoke("window:toggle-devtools"),
};

const stagepadAPI = {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  getProjectMeta,
  getProjectPath: (id) => getProjectDir(id),
  loadScene,
  saveScene,
  importAsset,
  importAssetFromBuffer,
  writeTempFile,
  convertAudio,
  normalizeAudio,
  analyzeLoudness,
  setProjectPerfFontSize,
  setProjectPreloadEnabled,
  setProjectClickActions,
  saveProjectCover: (projectId, fileName, arrayBuffer, config) => saveProjectCover(projectId, fileName, arrayBuffer, config),
  saveProjectLogo: (projectId, payload) => saveProjectLogo(projectId, payload),
  copyProjectAsset,
  getAssetFileUrl,
  saveTemplate,
  listTemplates,
  applyTemplate,
  findUnusedAudio,
  deleteProjectFiles,
  openCover: (projectId) => ipcRenderer.invoke("stagepad:open-cover", projectId),
  closeCover: () => ipcRenderer.invoke("stagepad:close-cover"),
  openMixer: () => ipcRenderer.invoke("stagepad:open-mixer"),
  launchPerformance: (projectId) =>
    ipcRenderer.invoke("modules:launch-with-query", {
      moduleId: "stagepad",
      query: { project: projectId, mode: "performance" },
    }),
  listDisplays: () => ipcRenderer.invoke("stagepad:list-displays"),
  getDisplayPreferences: () => ipcRenderer.invoke("stagepad:get-display-prefs"),
  saveDisplayPreferences: (prefs) => ipcRenderer.invoke("stagepad:set-display-prefs", prefs || {}),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("stagepad:set-always-on-top", Boolean(enabled)),
  getAlwaysOnTop: () => ipcRenderer.invoke("stagepad:get-always-on-top"),
  onStopMusicGlobal: (callback) => {
    ipcRenderer.removeAllListeners("stagepad:stop-music-global");
    ipcRenderer.on("stagepad:stop-music-global", (_event, payload) => callback?.(payload));
  },
  onCoverState: (callback) => {
    ipcRenderer.removeAllListeners("stagepad:cover-state");
    ipcRenderer.on("stagepad:cover-state", (_event, payload) => callback?.(payload));
  },
  onRemoteCommand: (callback) => {
    ipcRenderer.removeAllListeners("stagepad:remote-command");
    ipcRenderer.on("stagepad:remote-command", (_event, payload) => callback?.(payload));
  },
  sendRemoteState: (payload) => {
    ipcRenderer.send("stagepad:remote-state", payload);
  },
  notifyMusicPlay: (payload) => {
    ipcRenderer.send("stagepad:music-play", payload);
  },
  windowControls,
};

contextBridge.exposeInMainWorld("stagepadAPI", stagepadAPI);
contextBridge.exposeInMainWorld("stagepadWindow", { windowControls });
