const SUPPORTED_FORMATS = ["wav", "flac", "mp3", "ogg"];
const LOUDNESS_TARGET = -14;
let warnedAnalyzeMissing = false;

const sanitizeFolder = (name) => {
  const clean = (name || "audio").replace(/[^a-zA-Z0-9_\\-]/g, "_");
  return clean || "audio";
};

const buildTargetDir = (folder) => `audio/${sanitizeFolder(folder)}`;

const resolveSourcePath = async (file, targetName) => {
  if (file?.path) return file.path;
  if (typeof window.stagepadAPI?.writeTempFile === "function") {
    const buf =
      typeof file.arrayBuffer === "function"
        ? await file.arrayBuffer()
        : file.buffer instanceof ArrayBuffer
        ? file.buffer
        : null;
    if (!buf) return null;
    return window.stagepadAPI.writeTempFile(targetName || file.name, buf);
  }
  return null;
};

const copyBuffer = async (projectId, file, targetDir, targetName) => {
  const buf =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : file.buffer instanceof ArrayBuffer
      ? file.buffer
      : null;
  if (!buf) throw new Error("Невозможно прочитать содержимое файла");
  const name = targetName || file.name;
  return window.stagepadAPI.importAssetFromBuffer(projectId, name, buf, targetDir);
};

const copyFile = async (projectId, file, targetDir, targetName) => {
  if (file.path) {
    return window.stagepadAPI.importAsset(projectId, file.path, targetDir, targetName);
  }
  return copyBuffer(projectId, file, targetDir, targetName);
};

async function convertWithApi(projectId, file, targetDir, targetName, format, options, sourcePath) {
  if (!window.stagepadAPI?.convertAudio) {
    return null;
  }
  const resolvedPath = sourcePath || (await resolveSourcePath(file, targetName));
  if (!resolvedPath) return null;
  return window.stagepadAPI.convertAudio(resolvedPath, {
    projectId,
    targetDir,
    targetName,
    format,
    option: options?.option,
    bitrate: options?.bitrate,
    trimStart: options?.trimStart,
    trimEnd: options?.trimEnd,
  });
}

async function analyzeWithApi(file, targetName, options = {}) {
  if (!window.stagepadAPI?.analyzeLoudness) {
    if (!warnedAnalyzeMissing) {
      warnedAnalyzeMissing = true;
      console.info("[stagepad][loudness] analyze unavailable in this window");
    }
    return null;
  }
  const sourcePath = await resolveSourcePath(file, targetName);
  if (!sourcePath) return null;
  return window.stagepadAPI.analyzeLoudness(sourcePath, {
    trimStart: options?.trimStart,
    trimEnd: options?.trimEnd,
    targetI: LOUDNESS_TARGET,
  });
}

export async function convertAndImportFiles({
  projectId,
  files,
  folderName = "audio",
  format = "wav",
  formatOption = "",
  keepOriginal = false,
  skipProjectSave = false,
  onProgress,
}) {
  if (!Array.isArray(files) || !files.length) return [];
  if (!projectId && !skipProjectSave) {
    throw new Error("Проект не выбран для сохранения файлов");
  }
  const results = [];
  const safeFormat = SUPPORTED_FORMATS.includes(format) ? format : "wav";
  const targetDir = buildTargetDir(folderName);

  const optionToBitrate = (fmt, option) => {
    if (fmt === "mp3") {
      const map = { mp3_128: 128, mp3_192: 192, mp3_256: 256, mp3_320: 320 };
      return map[option] || 192;
    }
    if (fmt === "ogg") {
      const map = { ogg_q4: 128, ogg_q6: 192, ogg_q8: 256 };
      return map[option] || 192;
    }
    return undefined;
  };

  for (let i = 0; i < files.length; i += 1) {
    const entry = files[i];
    const file = entry?.file || entry;
    const baseName = (entry?.customName || file?.name || file?.path || `track_${i}`).replace(/\.[^.]+$/, "");
    const targetName = `${baseName}.${safeFormat}`;
    if (onProgress) onProgress({ current: i + 1, total: files.length, label: baseName });
    let loudnessGainDb = 0;
    try {
      const loudness = await analyzeWithApi(file, targetName, { trimStart: entry?.trimStart, trimEnd: entry?.trimEnd });
      if (Number.isFinite(loudness?.gainDb)) {
        loudnessGainDb = Math.max(-24, Math.min(24, Number(loudness.gainDb)));
      }
      console.info("[stagepad][loudness] analyzed", {
        file: baseName,
        inputI: Number.isFinite(loudness?.inputI) ? Number(loudness.inputI) : null,
        targetI: Number.isFinite(loudness?.targetI) ? Number(loudness.targetI) : LOUDNESS_TARGET,
        gainDb: loudnessGainDb,
      });
    } catch (_) {
      loudnessGainDb = 0;
      console.info("[stagepad][loudness] analyze failed", { file: baseName, gainDb: loudnessGainDb });
    }

    if (skipProjectSave) {
      results.push({ file: file.path || file.name, label: baseName, external: true, loudnessGainDb });
      continue;
    }

    if (keepOriginal) {
      const imported = await copyFile(projectId, file, targetDir, targetName);
      results.push({ file: imported, label: baseName, external: false, loudnessGainDb });
      continue;
    }

    const converted = await convertWithApi(projectId, file, targetDir, targetName, safeFormat, {
      option: formatOption,
      bitrate: optionToBitrate(safeFormat, formatOption),
      trimStart: entry?.trimStart,
      trimEnd: entry?.trimEnd,
    });
    if (!converted) {
      throw new Error("Конвертер недоступен или не смог обработать файл");
    }
    results.push({ file: converted, label: baseName, external: false, loudnessGainDb });
  }
  return results;
}
