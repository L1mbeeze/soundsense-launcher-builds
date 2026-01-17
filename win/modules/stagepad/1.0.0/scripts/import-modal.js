import { dom } from "./dom.js";
import { state } from "./state.js";
import { convertAndImportFiles } from "./converter.js";
import { stopAllAudio } from "./editor.js";
import { stopWavePreview } from "./waveform.js";

const STORAGE_KEY = "stagepadImportFolders";
const PREFS_KEY = "stagepadImportPrefs";

const FORMAT_PRESETS = {
  wav: [
    { value: "pcm16", label: "PCM 16-bit" },
    { value: "pcm24", label: "PCM 24-bit" },
  ],
  flac: [
    { value: "flac5", label: "FLAC level 5 (сбалансированно)" },
    { value: "flac8", label: "FLAC level 8 (макс сжатие)" },
  ],
  mp3: [
    { value: "mp3_128", label: "MP3 128 kbps" },
    { value: "mp3_192", label: "MP3 192 kbps" },
    { value: "mp3_256", label: "MP3 256 kbps" },
    { value: "mp3_320", label: "MP3 320 kbps" },
  ],
  ogg: [
    { value: "ogg_q4", label: "Ogg q4 (~128 kbps)" },
    { value: "ogg_q6", label: "Ogg q6 (~192 kbps)" },
    { value: "ogg_q8", label: "Ogg q8 (~256 kbps)" },
  ],
};

const loadFolderHistory = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveFolderHistory = (list) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(new Set(list)).slice(0, 10)));
  } catch {
    /* ignore */
  }
};

const loadPrefs = () => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
};

const savePrefs = (prefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
};

const buildFileRow = (item) => {
  const row = document.createElement("div");
  row.className = "import-item";
  row.dataset.id = item.id;
  row.innerHTML = `
    <div class="import-item__meta">
      <strong>${item.displayName}</strong>
      <input class="import-item__name" type="text" value="${item.displayName}" />
    </div>
    <div class="import-item__actions">
      <button class="btn small secondary" data-action="trim">SEL</button>
      <button class="btn small secondary" data-action="play">Плей</button>
      <button class="btn small ghost" data-action="stop">Стоп</button>
    </div>
  `;
  return row;
};

function setFormatVisibility() {
  if (!dom.importFormatOptions || !dom.importFormatSelect) return;
  const fmt = dom.importFormatSelect.value;
  const presets = FORMAT_PRESETS[fmt] || [];
  const html =
    presets.length > 0
      ? presets.map((p) => `<option value="${p.value}">${p.label}</option>`).join("")
      : `<option value="">По умолчанию</option>`;
  dom.importFormatOptions.innerHTML = html;
  dom.importFormatOptions.selectedIndex = 0;
}

function stopPreviews(list) {
  list.forEach((item) => {
    if (item.previewAudio) {
      item.previewAudio.pause();
      item.previewAudio = null;
    }
  });
  dom.importList?.querySelectorAll(".import-item").forEach((el) => el.classList.remove("playing"));
}

function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${sec}`;
}

const trimState = {
  item: null,
  peaks: null,
  duration: 0,
  selection: { start: 0, end: 0 },
  isDragging: false,
  audio: null,
  markerRaf: null,
  zoom: 1,
  pan: 0,
  selectionMode: null,
  edgeOffset: 0,
  lastTime: null,
  isPanning: false,
  panStart: 0,
};

function buildPeaks(buffer, width) {
  const channelData = buffer.getChannelData(0);
  const sampleCount = channelData.length;
  const buckets = Math.max(10, Math.floor(width));
  const samplesPerBucket = Math.max(1, Math.floor(sampleCount / buckets));
  const peaks = [];
  for (let i = 0; i < buckets; i += 1) {
    const start = i * samplesPerBucket;
    const end = Math.min(sampleCount, start + samplesPerBucket);
    let min = 1;
    let max = -1;
    for (let j = start; j < end; j += 1) {
      const sample = channelData[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    peaks.push({ min, max });
  }
  return peaks;
}

function drawImportWave(markerTime) {
  if (!dom.importWaveCanvas || !trimState.peaks || !trimState.duration) return;
  const { peaks, duration, selection } = trimState;
  const canvas = dom.importWaveCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || canvas.width || 1200;
  const height = canvas.height || 180;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(0, 200, 255, 0.06)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
  const half = height / 2;
  ctx.strokeStyle = "rgba(0, 255, 180, 0.8)";
  ctx.beginPath();
  const viewDuration = Math.max(0.1, duration / Math.max(1, trimState.zoom));
  const maxPan = Math.max(0, duration - viewDuration);
  const viewStart = Math.max(0, Math.min(trimState.pan, maxPan));
  const viewEnd = Math.min(duration, viewStart + viewDuration);
  const startIdx = Math.floor((viewStart / duration) * peaks.length);
  const endIdx = Math.ceil((viewEnd / duration) * peaks.length);
  const visiblePeaks = peaks.slice(Math.max(0, startIdx - 1), Math.min(peaks.length, endIdx + 1));
  const bucketWidth = width / Math.max(1, visiblePeaks.length);
  visiblePeaks.forEach((peak, idx) => {
    const x = idx * bucketWidth;
    const yTop = half - peak.max * half;
    const yBottom = half - peak.min * half;
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
  });
  ctx.stroke();

  if (selection?.end > selection?.start) {
    const startX = ((selection.start - viewStart) / viewDuration) * width;
    const endX = ((selection.end - viewStart) / viewDuration) * width;
    ctx.fillStyle = "rgba(255, 200, 80, 0.25)";
    ctx.fillRect(startX, 0, Math.max(1, endX - startX), height);
    ctx.strokeStyle = "rgba(255, 200, 80, 0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, 0, Math.max(1, endX - startX), height);
  }

  if (markerTime != null) {
    const viewDurationMarker = Math.max(0.1, duration / Math.max(1, trimState.zoom));
    const maxPanMarker = Math.max(0, duration - viewDurationMarker);
    const viewStartMarker = Math.max(0, Math.min(trimState.pan, maxPanMarker));
    const markerX = ((markerTime - viewStartMarker) / viewDurationMarker) * width;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX, height);
    ctx.stroke();
  }
}

function updateTrimLabels() {
  if (!dom.importTrimStartLabel || !dom.importTrimEndLabel || !dom.importTrimLenLabel) return;
  const { selection, duration } = trimState;
  dom.importTrimStartLabel.textContent = formatTime(selection.start);
  dom.importTrimEndLabel.textContent = formatTime(selection.end);
  dom.importTrimLenLabel.textContent = formatTime(Math.max(0, selection.end - selection.start));
  if (dom.importTrimInfo) {
    dom.importTrimInfo.textContent = `Итоговый файл: ${formatTime(selection.start)}–${formatTime(
      selection.end
    )} из ${formatTime(duration)}`;
  }
}

function setTrimSelection(start, end) {
  const { duration } = trimState;
  let s = Math.max(0, Math.min(start, duration));
  let e = Math.max(0, Math.min(end, duration));
  if (e < s) [s, e] = [e, s];
  if (e === s) {
    e = Math.min(duration, s + Math.max(0.05, duration * 0.01));
  }
  trimState.selection = { start: s, end: e };
  updateTrimLabels();
  drawImportWave(trimState.audio?.currentTime);
}

function setupFolderOptions(history) {
  if (!dom.importFolderSelect) return;
  dom.importFolderSelect.innerHTML = `<option value="">Недавние</option>${history
    .map((f) => `<option value="${f}">${f}</option>`)
    .join("")}`;
}

function stopTrimPreview() {
  if (trimState.audio) {
    trimState.audio.pause();
    trimState.audio = null;
  }
  if (trimState.markerRaf) {
    cancelAnimationFrame(trimState.markerRaf);
    trimState.markerRaf = null;
  }
}

function timeFromCanvasEvent(event) {
  if (!dom.importWaveCanvas || !trimState.duration) return 0;
  const rect = dom.importWaveCanvas.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  const viewDuration = Math.max(0.1, trimState.duration / Math.max(1, trimState.zoom));
  const maxPan = Math.max(0, trimState.duration - viewDuration);
  const viewStart = Math.max(0, Math.min(trimState.pan, maxPan));
  return viewStart + Math.max(0, Math.min(1, ratio)) * viewDuration;
}

function showProgressModal() {
  if (dom.importProgressModal) dom.importProgressModal.hidden = false;
  if (dom.importProgressBar) dom.importProgressBar.value = 0;
  if (dom.importProgressText) dom.importProgressText.textContent = "Подготовка…";
}

function hideProgressModal() {
  if (dom.importProgressModal) dom.importProgressModal.hidden = true;
}

function updateProgress(current, total, label) {
  if (dom.importProgressBar) dom.importProgressBar.value = Math.min(100, Math.round((current / total) * 100));
  if (dom.importProgressText) dom.importProgressText.textContent = `(${current}/${total}) ${label}`;
}

export function openImportModal(files) {
  return new Promise((resolve) => {
    if (!files?.length || !dom.importModal || !dom.importList) {
      resolve(null);
      return;
    }

    stopAllAudio();
    stopWavePreview();

  const folderHistory = loadFolderHistory();
  setupFolderOptions(folderHistory);

  const prefs = loadPrefs();
  if (dom.importFolderInput) dom.importFolderInput.value = prefs.folder || "audio";
  if (dom.importFormatSelect) dom.importFormatSelect.value = prefs.format || "wav";
  setFormatVisibility();
  if (dom.importFormatOptions) {
    const desired = prefs[prefs.format || ""]?.formatOption || prefs.formatOption;
    if (desired) dom.importFormatOptions.value = desired;
    if (!dom.importFormatOptions.value) dom.importFormatOptions.selectedIndex = 0;
  }
  if (dom.importKeepOriginal) dom.importKeepOriginal.checked = Boolean(prefs.keepOriginal);
  if (dom.importSkipProject) dom.importSkipProject.checked = false;

    const items = files.map((file, idx) => {
      const base = (file.name || file.path || `track_${idx}`).replace(/\.[^.]+$/, "");
      return {
        id: `import_${Date.now()}_${idx}`,
        file,
        displayName: base,
        previewAudio: null,
        trimStart: null,
        trimEnd: null,
        duration: null,
      };
    });

    dom.importList.innerHTML = "";
    items.forEach((item) => dom.importList.appendChild(buildFileRow(item)));

    const cleanup = () => {
      stopPreviews(items);
      stopTrimPreview();
      dom.importModal.hidden = true;
      if (dom.importTrimModal) dom.importTrimModal.hidden = true;
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    if (dom.importFormatSelect) {
      dom.importFormatSelect.onchange = setFormatVisibility;
    }

    const openTrimModal = async (item) => {
      if (!dom.importTrimModal || !dom.importWaveCanvas || !dom.importTrimName) return;
      try {
        stopTrimPreview();
        let duration = item.duration;
        let peaks = item.peaks;
        if (duration == null || !peaks) {
          const arrayBuffer =
            typeof item.file.arrayBuffer === "function"
              ? await item.file.arrayBuffer()
              : item.file.buffer instanceof ArrayBuffer
              ? item.file.buffer
              : null;
          if (!arrayBuffer) throw new Error("Не удалось прочитать файл");
          if (!window.__stagepadTrimCtx) {
            window.__stagepadTrimCtx = new (window.AudioContext || window.webkitAudioContext)();
          }
          const audioBuffer = await window.__stagepadTrimCtx.decodeAudioData(arrayBuffer.slice(0));
          duration = audioBuffer.duration;
          peaks = buildPeaks(audioBuffer, (dom.importWaveCanvas.clientWidth || dom.importWaveCanvas.width || 1200) * 2);
          item.duration = duration;
          item.peaks = peaks;
        }

        trimState.item = item;
        trimState.duration = duration;
        trimState.peaks = peaks;
        trimState.zoom = 1;
        trimState.pan = 0;
        const startVal = item.trimStart != null ? item.trimStart : 0;
        const endVal = item.trimEnd != null ? item.trimEnd : duration;
        setTrimSelection(startVal, endVal);
        dom.importTrimName.textContent = `${item.displayName} (${formatTime(duration)})`;
        if (dom.importTrimDuration) {
          dom.importTrimDuration.textContent = `Длительность файла: ${formatTime(duration)}`;
        }

        dom.importTrimModal.hidden = false;
      } catch (error) {
        alert(error?.message || "Не удалось открыть обрезку");
      }
    };

    dom.importList.onclick = (event) => {
      const btn = event.target.closest("[data-action]");
      if (!btn) return;
      const row = btn.closest(".import-item");
      const item = items.find((i) => i.id === row?.dataset.id);
      if (!item) return;
      if (btn.dataset.action === "trim") {
        openTrimModal(item);
        return;
      }
      if (btn.dataset.action === "play") {
        stopPreviews(items);
        dom.importList.querySelectorAll(".import-item").forEach((el) => el.classList.remove("playing"));
        const url = item.file.path ? item.file.path : URL.createObjectURL(item.file);
        item.previewAudio = new Audio(url);
        row?.classList.add("playing");
        item.previewAudio.play();
      } else if (btn.dataset.action === "stop") {
        if (item.previewAudio) {
          item.previewAudio.pause();
          item.previewAudio = null;
        }
        row?.classList.remove("playing");
      }
    };

    if (dom.importFolderSelect) {
      dom.importFolderSelect.onchange = (e) => {
        if (e.target.value && dom.importFolderInput) {
          dom.importFolderInput.value = e.target.value;
        }
      };
    }

  if (dom.importCancelBtn) dom.importCancelBtn.onclick = onCancel;

    if (dom.importTrimCancel) {
      dom.importTrimCancel.onclick = () => {
        stopTrimPreview();
        if (dom.importTrimModal) dom.importTrimModal.hidden = true;
      };
    }

    if (dom.importTrimSave) {
      dom.importTrimSave.onclick = () => {
        if (!trimState.item) return;
        const { start, end } = trimState.selection;
        trimState.item.trimStart = start;
        trimState.item.trimEnd = end;
        if (dom.importTrimModal) dom.importTrimModal.hidden = true;
        const row = dom.importList.querySelector(`[data-id="${trimState.item.id}"]`);
        row?.classList.toggle("trimmed", end - start > 0 && (start > 0 || end < trimState.duration));
        stopTrimPreview();
      };
    }

    if (dom.importTrimPlay) {
      dom.importTrimPlay.onclick = () => {
        if (!trimState.item || !trimState.duration) return;
        stopTrimPreview();
        const url = trimState.item.file.path
          ? trimState.item.file.path
          : URL.createObjectURL(trimState.item.file);
        const audio = new Audio(url);
        audio.currentTime = trimState.selection.start;
        audio.play();
        trimState.audio = audio;
        const stopAt = trimState.selection.end;
        const tick = () => {
          if (!trimState.audio) return;
          if (trimState.audio.currentTime >= stopAt) {
            stopTrimPreview();
            drawImportWave(trimState.selection.end);
            return;
          }
          drawImportWave(trimState.audio.currentTime);
          trimState.markerRaf = requestAnimationFrame(tick);
        };
        audio.addEventListener("ended", stopTrimPreview);
        tick();
      };
    }

    if (dom.importWaveCanvas) {
      dom.importWaveCanvas.onmousedown = (event) => {
        if (!trimState.duration) return;
        if (event.button === 1) {
          trimState.isPanning = true;
          trimState.panStart = event.clientX;
          dom.importWaveCanvas.style.cursor = "grabbing";
          event.preventDefault();
          return;
        }
        if (event.button !== 0) return;
        stopTrimPreview();
        const t = timeFromCanvasEvent(event);
        const { selection } = trimState;
        const rect = dom.importWaveCanvas.getBoundingClientRect();
        const width = rect.width;
        const viewDuration = Math.max(0.1, trimState.duration / Math.max(1, trimState.zoom));
        const maxPan = Math.max(0, trimState.duration - viewDuration);
        const viewStart = Math.max(0, Math.min(trimState.pan, maxPan));
        const startX = ((selection.start - viewStart) / viewDuration) * width;
        const endX = ((selection.end - viewStart) / viewDuration) * width;
        const handlePx = 10;
        if (Math.abs(event.clientX - (rect.left + startX)) <= handlePx) {
          trimState.selectionMode = "resize-start";
          trimState.edgeOffset = t - selection.start;
        } else if (Math.abs(event.clientX - (rect.left + endX)) <= handlePx) {
          trimState.selectionMode = "resize-end";
          trimState.edgeOffset = t - selection.end;
        } else if (t >= selection.start && t <= selection.end) {
          trimState.selectionMode = "move";
          trimState.lastTime = t;
        } else {
          trimState.selectionMode = "resize-end";
          trimState.edgeOffset = 0;
          setTrimSelection(selection.start, t);
        }
        trimState.isDragging = true;
      };
      dom.importWaveCanvas.onmousemove = (event) => {
        if (trimState.isPanning && trimState.duration) {
          const rect = dom.importWaveCanvas.getBoundingClientRect();
          const deltaPx = event.clientX - trimState.panStart;
          trimState.panStart = event.clientX;
          const viewDuration = Math.max(0.1, trimState.duration / Math.max(1, trimState.zoom));
          const deltaTime = (deltaPx / rect.width) * viewDuration;
          const maxPan = Math.max(0, trimState.duration - viewDuration);
          trimState.pan = Math.max(0, Math.min(trimState.pan - deltaTime, maxPan));
          drawImportWave(trimState.audio?.currentTime);
          return;
        }
        if (!trimState.isDragging || !trimState.duration || !trimState.selectionMode) return;
        const t = timeFromCanvasEvent(event);
        let { start, end } = trimState.selection;
        const minLen = Math.max(0.05, trimState.duration * 0.01);
        if (trimState.selectionMode === "resize-start") {
          start = Math.min(t - trimState.edgeOffset, end - minLen);
        } else if (trimState.selectionMode === "resize-end") {
          end = Math.max(t - trimState.edgeOffset, start + minLen);
        } else if (trimState.selectionMode === "move") {
          if (trimState.lastTime == null) trimState.lastTime = t;
          const delta = t - trimState.lastTime;
          const length = end - start;
          start = Math.max(0, Math.min(trimState.duration - length, start + delta));
          end = start + length;
          trimState.lastTime = t;
        }
        setTrimSelection(start, end);
      };
      dom.importWaveCanvas.onwheel = (event) => {
        if (!trimState.duration) return;
        event.preventDefault();
        const delta = Math.sign(event.deltaY);
        const zoomFactor = delta > 0 ? 1 / 1.1 : 1.1;
        const rect = dom.importWaveCanvas.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        const viewDuration = Math.max(0.1, trimState.duration / Math.max(1, trimState.zoom));
        const maxPan = Math.max(0, trimState.duration - viewDuration);
        const viewStart = Math.max(0, Math.min(trimState.pan, maxPan));
        const focusTime = viewStart + ratio * viewDuration;
        trimState.zoom = Math.max(1, Math.min(20, trimState.zoom * zoomFactor));
        const newViewDuration = Math.max(0.1, trimState.duration / Math.max(1, trimState.zoom));
        trimState.pan = Math.max(
          0,
          Math.min(focusTime - ratio * newViewDuration, Math.max(0, trimState.duration - newViewDuration))
        );
        drawImportWave(trimState.audio?.currentTime);
      };
      window.addEventListener("mouseup", () => {
        if (trimState.isPanning) {
          trimState.isPanning = false;
          if (dom.importWaveCanvas) dom.importWaveCanvas.style.cursor = "grab";
        }
        if (!trimState.isDragging) return;
        trimState.isDragging = false;
        trimState.selectionMode = null;
        trimState.lastTime = null;
      });
    }

    if (dom.importSaveBtn)
      dom.importSaveBtn.onclick = async () => {
        const folderName = dom.importFolderInput?.value?.trim() || "audio";
        const format = dom.importFormatSelect?.value || "wav";
        const formatOption = dom.importFormatOptions?.value || "";
        const keepOriginal = Boolean(dom.importKeepOriginal?.checked);
        const skipProject = Boolean(dom.importSkipProject?.checked);

        const formatPrefs = loadPrefs();
        const nextPrefs = {
          ...formatPrefs,
          folder: folderName,
          format,
          formatOption,
          keepOriginal,
          [format]: { formatOption },
        };
        savePrefs(nextPrefs);
        saveFolderHistory([folderName, ...folderHistory]);

        items.forEach((item) => {
          const row = dom.importList.querySelector(`[data-id="${item.id}"]`);
          const nameInput = row?.querySelector(".import-item__name");
          if (nameInput?.value) {
            item.displayName = nameInput.value.trim() || item.displayName;
          }
          if (item.trimStart != null && item.trimEnd != null) {
            row?.classList.add("trimmed");
          } else {
            row?.classList.remove("trimmed");
          }
        });

        showProgressModal();
        try {
          const forceProjectSave = items.some((i) => i.trimStart != null || i.trimEnd != null);
          console.info("[stagepad][loudness] import start", {
            files: items.length,
            format,
            keepOriginal,
            skipProjectSave: forceProjectSave ? false : skipProject,
          });
          const converted = await convertAndImportFiles({
            projectId: state.currentProject?.id,
            files: items.map((i) => ({
              file: i.file,
              customName: i.displayName,
              trimStart: i.trimStart,
              trimEnd: i.trimEnd,
            })),
            folderName,
            format,
            formatOption,
            keepOriginal,
            skipProjectSave: forceProjectSave ? false : skipProject,
            onProgress: ({ current, total, label }) => updateProgress(current, total, label),
          });
          console.info(
            "[stagepad][loudness] import done",
            converted.map((entry) => ({
              file: entry.label || entry.file,
              gainDb: Number.isFinite(entry.loudnessGainDb) ? Number(entry.loudnessGainDb) : 0,
            }))
          );
          hideProgressModal();
          cleanup();
          resolve(
            converted.map((entry, idx) => ({
              id: `track_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              file: entry.file,
              label: items[idx]?.displayName || entry.label || entry.file,
              external: entry.external,
              loudnessGainDb: Number.isFinite(entry.loudnessGainDb) ? Number(entry.loudnessGainDb) : 0,
              normalizedFile: "",
              useNormalized: false,
            }))
          );
        } catch (error) {
          hideProgressModal();
          alert(error?.message || "Не удалось сконвертировать/сохранить файл");
          cleanup();
          resolve(null);
        }
      };

    dom.importModal.hidden = false;
  });
}
