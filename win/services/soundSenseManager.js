const fs = require("fs");
const path = require("path");
const https = require("https");
const { app, shell } = require("electron");
const { spawn } = require("child_process");
const remoteVersionService = require("./remoteVersion");
const { hashFile } = require("./localVersion");

const MAX_DOWNLOAD_ATTEMPTS = 3;
const REMOTE_CACHE_TTL = 60 * 1000;

let cachedRemoteVersion = null;
let cachedRemoteFetchedAt = 0;
let currentOperation = null;

function getLauncherRoot() {
  if (app && typeof app.getPath === "function") {
    try {
      return app.getPath("userData");
    } catch (error) {
      console.warn("Не удалось получить userData, fallback к cwd:", error);
    }
  }
  return path.join(process.cwd(), "SoundSenseData");
}

function getGamesDir() {
  return path.join(getLauncherRoot(), "Games");
}

function getSoundSenseDir() {
  return path.join(getGamesDir(), "SoundSense");
}

function getVersionDir() {
  return path.join(getSoundSenseDir(), "version");
}

function getVersionFilePath() {
  return path.join(getVersionDir(), "version_files.json");
}

function getSoundSenseFile(relativePath) {
  return path.join(getSoundSenseDir(), relativePath);
}

async function openSoundSenseFolder() {
  ensureGameFolders();
  const dir = getSoundSenseDir();
  const result = await shell.openPath(dir);
  if (result) {
    throw new Error(result);
  }
  return dir;
}

function sendProgress(cb, payload) {
  if (typeof cb === "function") {
    cb(payload);
  }
}

function normalizeRelative(filePath) {
  return filePath.replace(/\\/g, "/");
}

function normalizeKey(filePath) {
  return normalizeRelative(filePath).toLowerCase();
}

function calcPercent(processed, fileRatio, total) {
  if (!total) return 0;
  const percent = ((processed + fileRatio) / total) * 100;
  return Math.min(100, Math.max(0, percent));
}

function ensureGameFolders() {
  fs.mkdirSync(getGamesDir(), { recursive: true });
  fs.mkdirSync(getSoundSenseDir(), { recursive: true });
  fs.mkdirSync(getVersionDir(), { recursive: true });
}

async function clearSoundSenseDir() {
  const dir = getSoundSenseDir();
  if (fs.existsSync(dir)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

function downloadFileWithProgress(entry, destinationPath, { onProgress } = {}) {
  const normalized = normalizeRelative(entry.file);
  const url = `${remoteVersionService.REMOTE_BASE_URL}/${normalized}`;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const tempPath = `${destinationPath}.download`;
    const request = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(
          new Error(`HTTP ${res.statusCode} при скачивании ${entry.file}`)
        );
        return;
      }

      const expectedBytes =
        entry.size && entry.size > 0
          ? entry.size
          : parseInt(res.headers["content-length"] || "0", 10) || 1;
      let downloaded = 0;

      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (typeof onProgress === "function") {
          const ratio = Math.min(downloaded / expectedBytes, 0.999);
          onProgress(ratio);
        }
      });

      const fileStream = fs.createWriteStream(tempPath);
      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close(() => {
          fs.rename(tempPath, destinationPath, (err) => {
            if (err) {
              reject(err);
              return;
            }
            if (typeof onProgress === "function") {
              onProgress(1);
            }
            resolve(destinationPath);
          });
        });
      });

      fileStream.on("error", (error) => {
        fs.rm(tempPath, { force: true }, () => reject(error));
      });
    });

    request.on("error", (error) => {
      fs.rm(tempPath, { force: true }, () => reject(error));
    });
  });
}

async function getRemoteVersion(force = false) {
  const now = Date.now();
  if (
    !force &&
    cachedRemoteVersion &&
    now - cachedRemoteFetchedAt < REMOTE_CACHE_TTL
  ) {
    return cachedRemoteVersion;
  }

  const remote = await remoteVersionService.fetchRemoteVersion();
  cachedRemoteVersion = remote;
  cachedRemoteFetchedAt = now;
  return remote;
}

function getLocalVersion() {
  try {
    const raw = fs.readFileSync(getVersionFilePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalVersion(versionData) {
  fs.mkdirSync(getVersionDir(), { recursive: true });
  fs.writeFileSync(
    getVersionFilePath(),
    JSON.stringify(versionData, null, 2),
    "utf-8"
  );
}

function hasValidLocalVersion(localVersion) {
  return (
    localVersion &&
    Array.isArray(localVersion.files) &&
    localVersion.files.length > 0
  );
}

function describeBuildSize(buildSize) {
  if (!buildSize) return "Размер: —";

  if (buildSize.gb && buildSize.gb >= 1) {
    return `Размер: ${buildSize.gb.toFixed(2)} GB`;
  }

  if (buildSize.mb && buildSize.mb >= 1) {
    return `Размер: ${buildSize.mb.toFixed(2)} MB`;
  }

  if (buildSize.kb && buildSize.kb >= 1) {
    return `Размер: ${buildSize.kb.toFixed(0)} KB`;
  }

  if (typeof buildSize.bytes === "number") {
    return `Размер: ${buildSize.bytes} байт`;
  }

  return "Размер: —";
}

function describeInstallState(localVersion) {
  const installed = hasValidLocalVersion(localVersion);
  return {
    installed,
  };
}

function getExecutablePath() {
  return path.join(getSoundSenseDir(), "SSUT.exe");
}

function executableExists() {
  return fs.existsSync(getExecutablePath());
}

function versionsMatch(remoteVersion, localVersion) {
  if (!remoteVersion || !localVersion) return false;
  if (!Array.isArray(remoteVersion.files) || !Array.isArray(localVersion.files)) {
    return false;
  }
  if (remoteVersion.files.length !== localVersion.files.length) {
    return false;
  }
  const localMap = new Map();
  for (const entry of localVersion.files) {
    localMap.set(normalizeKey(entry.file), entry.hash.toLowerCase());
  }
  for (const entry of remoteVersion.files) {
    const localHash = localMap.get(normalizeKey(entry.file));
    if (!localHash || localHash !== entry.hash.toLowerCase()) {
      return false;
    }
  }
  return true;
}

function formatState({
  localVersion,
  remoteVersion,
  remoteError = null,
} = {}) {
  const installState = describeInstallState(localVersion);
  const buildSizeSource =
    installState.installed && localVersion
      ? localVersion.build_size
      : remoteVersion?.build_size;

  return {
    ...installState,
    localVersion,
    remoteVersion,
    buildSizeLabel: describeBuildSize(buildSizeSource),
    executableExists: executableExists(),
    soundSenseDir: getSoundSenseDir(),
    versionFile: getVersionFilePath(),
    remoteError: remoteError ? remoteError.message : null,
    operation: currentOperation,
  };
}

async function listInstalledFiles(baseDir, relativeBase = "") {
  const absolute = path.join(baseDir, relativeBase);
  if (!fs.existsSync(absolute)) return [];
  const entries = await fs.promises.readdir(absolute, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const nextRelative = path.join(relativeBase, entry.name);
    const normalized = normalizeRelative(nextRelative);
    const normalizedLower = normalized.toLowerCase();
    if (entry.isDirectory()) {
      if (normalizedLower.startsWith("version")) {
        continue;
      }
      const nested = await listInstalledFiles(baseDir, nextRelative);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(normalized);
    }
  }

  return files;
}

async function removeGarbageFiles(remoteVersion) {
  const baseDir = getSoundSenseDir();
  if (!fs.existsSync(baseDir)) return;
  if (!remoteVersion?.files) return;

  const allowed = new Set(
    remoteVersion.files.map((entry) => normalizeKey(entry.file))
  );
  const existing = await listInstalledFiles(baseDir);
  const removals = [];

  for (const relative of existing) {
    if (!allowed.has(normalizeKey(relative))) {
      removals.push(relative);
    }
  }

  await Promise.all(
    removals.map((file) =>
      fs.promises.rm(path.join(baseDir, file), { force: true })
    )
  );
}

async function syncWithRemoteVersion(remoteVersion, { onProgress, actionLabel }) {
  ensureGameFolders();
  await verifyWithRepair(remoteVersion, { onProgress, actionLabel });
  await removeGarbageFiles(remoteVersion);
  writeLocalVersion(remoteVersion);
  return remoteVersion;
}

async function downloadAndVerifyFile(entry, attempt = 1, progressOptions = {}) {
  const targetPath = getSoundSenseFile(entry.file);
  await downloadFileWithProgress(entry, targetPath, progressOptions);
  const hash = await hashFile(targetPath);
  if (hash.toLowerCase() !== entry.hash.toLowerCase()) {
    if (attempt >= MAX_DOWNLOAD_ATTEMPTS) {
      throw new Error(
        `Не удалось загрузить файл ${entry.file}: хэш не совпадает`
      );
    }
    await fs.promises.rm(targetPath, { force: true });
    return downloadAndVerifyFile(entry, attempt + 1, progressOptions);
  }
  return targetPath;
}

async function verifyWithRepair(version, { onProgress, actionLabel }) {
  if (!version || !Array.isArray(version.files)) {
    throw new Error("Некорректные данные версии");
  }

  const total = version.files.length;
  let processed = 0;

  for (const entry of version.files) {
    const filePath = getSoundSenseFile(entry.file);
    sendProgress(onProgress, {
      action: actionLabel,
      phase: "checking",
      percent: calcPercent(processed, 0, total),
      current: processed,
      total,
      file: entry.file,
      status: `Проверка ${entry.file}`,
    });

    let needsDownload = false;
    if (!fs.existsSync(filePath)) {
      needsDownload = true;
    } else {
      const hash = await hashFile(filePath);
      if (hash.toLowerCase() !== entry.hash.toLowerCase()) {
        needsDownload = true;
      }
    }

    if (needsDownload) {
      sendProgress(onProgress, {
        action: actionLabel,
        phase: "repair",
        percent: calcPercent(processed, 0, total),
        current: processed,
        total,
        file: entry.file,
        status: `Восстановление ${entry.file}`,
      });
      await downloadAndVerifyFile(entry, 1, {
        onProgress: (ratio) =>
          sendProgress(onProgress, {
            action: actionLabel,
            phase: "repair",
            percent: calcPercent(processed, ratio, total),
            current: processed + ratio,
            total,
            file: entry.file,
            status: `Восстановление ${entry.file} (${Math.round(
              ratio * 100
            )}%)`,
          }),
      });
    }

    processed += 1;
    sendProgress(onProgress, {
      action: actionLabel,
      phase: "checking",
      percent: calcPercent(processed, 0, total),
      current: processed,
      total,
      file: entry.file,
      status: `Готово: ${entry.file}`,
    });
  }
}

async function quickScan(localVersion, { onProgress, actionLabel }) {
  if (!localVersion || !Array.isArray(localVersion.files)) {
    return { ok: false, reason: "version-missing" };
  }

  const total = localVersion.files.length;
  let processed = 0;

  for (const entry of localVersion.files) {
    const filePath = getSoundSenseFile(entry.file);
    sendProgress(onProgress, {
      action: actionLabel,
      phase: "prelaunch",
      percent: calcPercent(processed, 0, total),
      current: processed,
      total,
      file: entry.file,
      status: `Проверка ${entry.file}`,
    });

    if (!fs.existsSync(filePath)) {
      return { ok: false, reason: "missing-file", file: entry.file };
    }

    const hash = await hashFile(filePath);
    if (hash.toLowerCase() !== entry.hash.toLowerCase()) {
      return { ok: false, reason: "hash-mismatch", file: entry.file };
    }

    processed += 1;
  }

  sendProgress(onProgress, {
    action: actionLabel,
    phase: "prelaunch",
    percent: 100,
    current: total,
    total,
    status: "Проверка перед запуском завершена",
  });

  return { ok: true };
}

async function runExclusive(operationName, handler) {
  if (currentOperation) {
    throw new Error("Другая операция уже выполняется");
  }
  currentOperation = operationName;
  try {
    return await handler();
  } finally {
    currentOperation = null;
  }
}

async function performInstall({ onProgress }) {
  sendProgress(onProgress, {
    action: "install",
    phase: "starting",
    percent: 0,
    status: "Подготовка…",
  });

  const remoteVersion = await getRemoteVersion(true);
  ensureGameFolders();
  await clearSoundSenseDir();
  ensureGameFolders();

  const total = remoteVersion.files.length;
  let processed = 0;

  for (const entry of remoteVersion.files) {
    const baseStatus = (ratio, label) => {
      sendProgress(onProgress, {
        action: "install",
        phase: "downloading",
        percent: calcPercent(processed, ratio, total),
        current: processed + ratio,
        total,
        file: entry.file,
        status: label,
      });
    };

    baseStatus(0, `Скачивание ${entry.file}`);

    await downloadAndVerifyFile(entry, 1, {
      onProgress: (ratio) =>
        baseStatus(ratio, `Скачивание ${entry.file} (${Math.round(
          ratio * 100
        )}%)`),
    });

    processed += 1;

    baseStatus(0, "Файл установлен");
  }

  writeLocalVersion(remoteVersion);
  return remoteVersion;
}

async function performIntegrityCheck({ onProgress }) {
  const localVersion = getLocalVersion();
  if (!localVersion) {
    throw new Error(
      "Локальные данные отсутствуют. Установите игру заново."
    );
  }
  const remoteVersion = await getRemoteVersion(true);
  return syncWithRemoteVersion(remoteVersion, {
    onProgress,
    actionLabel: "verify",
  });
}

async function performLaunch({ onProgress }) {
  let localVersion = getLocalVersion();
  if (!localVersion) {
    throw new Error(
      "Локальный файл версии не найден. Переустановите игру."
    );
  }

  ensureGameFolders();

  let remoteVersion = null;
  try {
    remoteVersion = await getRemoteVersion(true);
  } catch (error) {
    // Игру все равно можно запустить по локальным данным, но логируем отсутствие связи.
    console.warn("Не удалось получить удаленную версию перед запуском:", error);
  }

  const remoteNewer = remoteVersion && !versionsMatch(remoteVersion, localVersion);

  if (remoteNewer) {
    sendProgress(onProgress, {
      action: "verify",
      phase: "checking",
      percent: 0,
      status: `Найдена новая версия ${remoteVersion.version}, обновляем…`,
    });
    localVersion = await syncWithRemoteVersion(remoteVersion, {
      onProgress,
      actionLabel: "verify",
    });
  }

  const quickResult = await quickScan(localVersion, {
    onProgress,
    actionLabel: "verify",
  });

  if (!quickResult.ok) {
    sendProgress(onProgress, {
      action: "verify",
      phase: "repair",
      percent: 0,
      status: "Обнаружены повреждения, запускаем восстановление…",
    });
    await performIntegrityCheck({ onProgress });
  }

  const exePath = getExecutablePath();
  if (!fs.existsSync(exePath)) {
    throw new Error("Исполняемый файл игры не найден.");
  }

  const child = spawn(exePath, {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { launched: true };
}

async function installSoundSense(options = {}) {
  return runExclusive("install", () => performInstall(options));
}

async function checkIntegrity(options = {}) {
  return runExclusive("verify", () => performIntegrityCheck(options));
}

async function launchSoundSense(options = {}) {
  return runExclusive("launch", () => performLaunch(options));
}

async function performDelete({ onProgress }) {
  sendProgress(onProgress, {
    action: "delete",
    phase: "starting",
    percent: 0,
    status: "Подготовка к удалению…",
  });

  const dir = getSoundSenseDir();
  if (fs.existsSync(dir)) {
    sendProgress(onProgress, {
      action: "delete",
      phase: "removing",
      percent: 10,
      status: "Удаляем файлы…",
    });
    await fs.promises.rm(dir, { recursive: true, force: true });
  }

  sendProgress(onProgress, {
    action: "delete",
    phase: "cleanup",
    percent: 65,
    status: "Очищаем кэш…",
  });
  ensureGameFolders();

  sendProgress(onProgress, {
    action: "delete",
    phase: "done",
    percent: 100,
    status: "Игра удалена",
  });

  return { deleted: true };
}

async function deleteSoundSense(options = {}) {
  return runExclusive("delete", () => performDelete(options));
}

async function getSoundSenseState() {
  const localVersion = getLocalVersion();
  let remote = null;
  let remoteError = null;

  try {
    remote = await getRemoteVersion(false);
  } catch (error) {
    remoteError = error;
  }

  return formatState({
    localVersion,
    remoteVersion: remote,
    remoteError,
  });
}

function isSoundSenseInstalled() {
  return hasValidLocalVersion(getLocalVersion());
}

module.exports = {
  getSoundSenseState,
  installSoundSense,
  checkIntegrity,
  launchSoundSense,
  isSoundSenseInstalled,
  openSoundSenseFolder,
  deleteSoundSense,
};
