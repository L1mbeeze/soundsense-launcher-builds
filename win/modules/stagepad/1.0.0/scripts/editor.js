import { ensureApi } from "./api.js";
import { dom } from "./dom.js";
import { DEFAULT_COLS, DEFAULT_ROWS, state } from "./state.js";
import { baseName, computeListMode, resetEmptyDisplay } from "./utils.js";
import {
  continueWaveInteraction,
  drawWaveform,
  findTrackById,
  getReversedSegmentUrl,
  playWavePreview,
  resolveSegment,
  setStartMarker,
  showWaveform,
  startWaveInteraction,
  stopWaveInteraction,
  stopWavePreview,
  updateTrackSegment,
} from "./waveform.js";

export function applyGridCss() {
  if (dom.stageGrid) {
    const listMode = document.body.classList.contains("perf-list-mode");
    dom.stageGrid.style.setProperty("--grid-cols", state.gridCols);
    dom.stageGrid.style.setProperty("--grid-rows", state.gridRows);
    const fontPx = state.isPerformance
      ? state.perfFontSize
      : Math.max(12, Math.min(22, 26 - state.gridRows * 0.7 - state.gridCols * 0.3));
    const fontValue = `${fontPx}px`;
    dom.stageGrid.style.setProperty("--cell-font", fontValue);
    // Дублируем в корень, чтобы кастомное свойство подхватывалось сразу во всех состояниях
    document.documentElement?.style?.setProperty("--cell-font", fontValue);
    if (state.isPerformance) {
      if (listMode) {
        dom.stageGrid.style.setProperty("grid-template-columns", "1fr");
      } else {
        dom.stageGrid.style.setProperty("grid-template-columns", "repeat(var(--grid-cols), minmax(0, 1fr))");
      }
    } else {
      dom.stageGrid.style.removeProperty("grid-template-columns");
    }
  }
}

const DEBUG_LOOP = true;
const safePlay = (audio, context) => {
  const result = audio.play();
  if (result?.catch) {
    result.catch((error) => {
      if (DEBUG_LOOP) {
        console.warn("[stagepad][loop] play failed", {
          context,
          name: error?.name,
          message: error?.message || error,
        });
      }
    });
  }
  return result;
};

const updatePreloadButtonUI = () => {
  if (dom.perfPreloadToggle) {
    dom.perfPreloadToggle.textContent = `Предзагрузка: ${state.preloadEnabled ? "вкл" : "выкл"}`;
    dom.perfPreloadToggle.setAttribute("aria-pressed", state.preloadEnabled ? "true" : "false");
  }
};

const getAudioOutputId = (isPerformance) => {
  const key = isPerformance ? "stagepadAudioOutputPerformance" : "stagepadAudioOutputEditor";
  const val = localStorage.getItem(key) || "";
  if (isPerformance) {
    state.audioOutputPerformance = val;
  } else {
    state.audioOutputEditor = val;
  }
  return val;
};

const applyAudioOutput = async (audio, isPerformance) => {
  if (!audio?.setSinkId) return;
  const deviceId = getAudioOutputId(isPerformance);
  if (!deviceId) return;
  try {
    await audio.setSinkId(deviceId);
  } catch (error) {
    console.warn("Не удалось применить аудиовыход:", error);
  }
};

const clampGroupIndex = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(11, Math.round(num)));
};

const ACTIVE_GROUPS_KEY = "stagepadMixerActiveGroups";
const PROJECT_GROUPS_PREFIX = "stagepadProjectGroups:";
const PROJECT_GROUPS_UPDATED_KEY = "stagepadProjectGroupsUpdated";
const ACTIVE_PERF_PROJECT_KEY = "stagepadActivePerformanceProject";
const METER_LEVELS_KEY = "stagepadMixerGroupLevels";
const METER_GROUPS = 12;
let meterContext = null;
let meterSilentGain = null;
let meterAnalyzers = [];
let meterTimer = null;
let meterSinkId = "";
let meterSinkSupported = null;

const getCurrentAudioOutputId = () => (state.isPerformance ? state.audioOutputPerformance : state.audioOutputEditor) || "";

const getGroupGain = (index) => {
  const idx = clampGroupIndex(index);
  const groups = state.mixerGroups;
  const raw = Array.isArray(groups) ? groups[idx] : 1;
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
};

const dbToGain = (db) => Math.pow(10, Number(db) / 20);
const getPlaybackFile = (track) =>
  track?.useNormalized && typeof track.normalizedFile === "string" && track.normalizedFile
    ? track.normalizedFile
    : track?.file || "";

const ensureMeterContext = () => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!meterContext) {
    meterContext = new Ctx();
    meterSilentGain = meterContext.createGain();
    meterSilentGain.gain.value = 0;
    meterSilentGain.connect(meterContext.destination);
    meterAnalyzers = Array.from({ length: METER_GROUPS }, () => {
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      analyser.connect(meterSilentGain);
      return { analyser, buffer: new Uint8Array(analyser.fftSize) };
    });
    meterSinkSupported = typeof meterContext.setSinkId === "function";
  }
  if (meterContext.state === "suspended") {
    meterContext.resume().catch(() => {});
  }
  if (meterSinkSupported) {
    const outputId = getCurrentAudioOutputId();
    if (outputId !== meterSinkId) {
      meterContext
        .setSinkId(outputId || "default")
        .then(() => {
          meterSinkId = outputId || "default";
        })
        .catch(() => {
          meterSinkId = "";
        });
    }
  }
  return meterContext;
};

const getMeterSource = (entry) => {
  if (entry?._meterSource) return entry._meterSource;
  const audio = entry?.audio;
  if (!audio) return null;
  const ctx = ensureMeterContext();
  if (!ctx) return null;
  let stream = null;
  try {
    if (audio.captureStream) stream = audio.captureStream();
    else if (audio.mozCaptureStream) stream = audio.mozCaptureStream();
  } catch (_) {
    stream = null;
  }
  if (stream) {
    try {
      entry._meterSource = ctx.createMediaStreamSource(stream);
      entry._meterSourceKind = "stream";
    } catch (_) {
      return null;
    }
    return entry._meterSource;
  }
  try {
    entry._meterSource = ctx.createMediaElementSource(audio);
    entry._meterSourceKind = "element";
  } catch (_) {
    return null;
  }
  return entry._meterSource;
};

const attachEntryToGroupMeter = (entry) => {
  const source = getMeterSource(entry);
  if (!source) return;
  const idx = clampGroupIndex(entry.group);
  const analyserEntry = meterAnalyzers[idx];
  const analyser = analyserEntry?.analyser;
  if (!analyser || entry._meterAnalyser === analyser) return;
  entry._meterAttaching = true;
  try {
    if (entry._meterAnalyser) source.disconnect(entry._meterAnalyser);
  } catch (_) {
    /* ignore */
  }
  try {
    source.connect(analyser);
  } catch (_) {
    /* ignore */
  }
  if (entry._meterSourceKind === "element" && !entry._meterOutConnected) {
    try {
      source.connect(meterContext.destination);
      entry._meterOutConnected = true;
    } catch (_) {
      /* ignore */
    }
  }
  entry._meterAnalyser = analyser;
  entry._meterAttaching = false;
  if (!meterTimer) {
    meterTimer = setInterval(() => {
      const levels = meterAnalyzers.map((item) => {
        if (!item?.analyser) return 0;
        const { analyser, buffer } = item;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const floor = 0.002;
        const normalized = Math.max(0, (rms - floor) / (1 - floor));
        const shaped = Math.pow(normalized, 0.5);
        return Math.max(0, Math.min(1, shaped * 1.6));
      });
      localStorage.setItem(METER_LEVELS_KEY, JSON.stringify(levels));
    }, 80);
  }
};

let lastProjectGroupsId = null;
const getProjectGroupsKey = (projectId) => `${PROJECT_GROUPS_PREFIX}${projectId}`;

const publishProjectGroups = () => {
  const projectId = state.currentProject?.id;
  if (!projectId) return;
  const used = new Set();
  (state.scene?.buttons || []).forEach((btn) => {
    const hasAudio = Boolean((btn?.tracks && btn.tracks.length) || btn?.file);
    if (!hasAudio) return;
    const group = typeof btn.audioGroup === "number" ? clampGroupIndex(btn.audioGroup) : 0;
    used.add(group);
  });
  lastProjectGroupsId = projectId;
  localStorage.setItem(
    getProjectGroupsKey(projectId),
    JSON.stringify({ projectId, groups: Array.from(used), updatedAt: Date.now() })
  );
  localStorage.setItem(PROJECT_GROUPS_UPDATED_KEY, String(Date.now()));
};

export function clearProjectGroups() {
  if (!lastProjectGroupsId) return;
  localStorage.removeItem(getProjectGroupsKey(lastProjectGroupsId));
  localStorage.setItem(PROJECT_GROUPS_UPDATED_KEY, String(Date.now()));
  lastProjectGroupsId = null;
}

const ensureProjectGroupSync = () => {
  const currentId = state.currentProject?.id;
  if (lastProjectGroupsId && lastProjectGroupsId !== currentId) {
    localStorage.removeItem(getProjectGroupsKey(lastProjectGroupsId));
  }
  if (currentId) {
    publishProjectGroups();
  }
};

const detachEntryFromMeter = (entry) => {
  if (!entry?._meterSource || !entry._meterAnalyser) return;
  try {
    entry._meterSource.disconnect(entry._meterAnalyser);
  } catch (_) {
    /* ignore */
  }
  if (entry._meterSourceKind === "element" && entry._meterOutConnected) {
    try {
      entry._meterSource.disconnect(meterContext.destination);
    } catch (_) {
      /* ignore */
    }
    entry._meterOutConnected = false;
  }
  entry._meterAnalyser = null;
};

const publishActiveGroups = () => {
  const active = new Set();
  state.players.forEach((entry) => {
    if (entry?.audio && !entry.audio.paused) {
      active.add(clampGroupIndex(entry.group));
    }
  });
  localStorage.setItem(ACTIVE_GROUPS_KEY, JSON.stringify(Array.from(active)));
  if (active.size === 0) {
    localStorage.setItem(METER_LEVELS_KEY, JSON.stringify(Array.from({ length: METER_GROUPS }, () => 0)));
  }
};

const setEntryBaseVolume = (entry, base) => {
  if (!entry?.audio) return;
  const gain = getGroupGain(entry.group);
  const safeBase = Math.max(0, Math.min(1, base));
  const loudnessDb = Number.isFinite(entry.loudnessGainDb) ? entry.loudnessGainDb : 0;
  const loudnessGain = state.normalizationEnabled ? dbToGain(loudnessDb) : 1;
  entry.baseVolume = safeBase;
  entry.audio.volume = Math.max(0, Math.min(1, safeBase * loudnessGain * gain));
};

const applyGroupVolume = (entry) => {
  if (!entry?.audio) return;
  const base = Number.isFinite(entry.baseVolume) ? entry.baseVolume : entry.audio.volume ?? 1;
  setEntryBaseVolume(entry, base);
};

const fadeEntryVolume = (entry, from, to, duration, onDone) => {
  if (!entry?.audio) {
    if (onDone) onDone();
    return;
  }
  if (duration <= 0) {
    setEntryBaseVolume(entry, to);
    if (onDone) onDone();
    return;
  }
  const steps = Math.max(1, Math.round(duration / 50));
  const delta = (to - from) / steps;
  let current = from;
  setEntryBaseVolume(entry, current);
  const timer = setInterval(() => {
    current += delta;
    if ((delta > 0 && current >= to) || (delta < 0 && current <= to)) {
      clearInterval(timer);
      setEntryBaseVolume(entry, to);
      if (onDone) onDone();
      return;
    }
    setEntryBaseVolume(entry, current);
  }, 50);
};

export function refreshGroupVolumes() {
  state.players.forEach((entry) => {
    if (entry?.audio) applyGroupVolume(entry);
  });
}

export function updateLayoutMode() {
  if (!state.isPerformance) {
    document.body.classList.remove("narrow-perf");
    document.body.classList.remove("perf-list-mode");
    document.body.classList.remove("wide-perf");
    return;
  }
  const narrow = window.innerWidth < 1200 || (dom.stageGrid?.clientWidth || 0) < 1100;
  document.body.classList.toggle("narrow-perf", narrow);
  const needList = computeListMode();
  document.body.classList.toggle("perf-list-mode", needList);
  document.body.classList.toggle("wide-perf", !needList && window.innerWidth >= 700);
  resetEmptyDisplay();
  applyGridCss();
}

export function updateListToggleVisibility() {
  if (!dom.btnToggleList) return;
  dom.btnToggleList.hidden = !state.isPerformance;
  const label = state.perfListMode ? "Вид: список" : "Вид: сетка";
  dom.btnToggleList.textContent = label;
  dom.btnToggleList.setAttribute("aria-pressed", state.perfListMode ? "true" : "false");
}

export const getPositionIndex = (row, col) => row * state.gridCols + col;
export const getButtonAt = (row, col) => {
  const index = getPositionIndex(row, col);
  return state.scene.buttons.find((btn) => btn.position === index);
};

export function setSceneDirty(value = true) {
  state.sceneDirty = Boolean(value);
  if (state.sceneDirty) {
    ensureProjectGroupSync();
  }
  if (dom.btnSaveScene) {
    if (state.sceneDirty) {
      dom.btnSaveScene.classList.remove("secondary");
      dom.btnSaveScene.classList.add("dirty");
    } else {
      dom.btnSaveScene.classList.add("secondary");
      dom.btnSaveScene.classList.remove("dirty");
    }
    dom.btnSaveScene.disabled = false;
  }
}

export function clampButtonsToGrid() {
  const maxSlots = state.gridRows * state.gridCols;
  const occupied = new Set();
  const findNextFree = () => {
    for (let i = 0; i < maxSlots; i += 1) {
      if (!occupied.has(i)) return i;
    }
    return null;
  };
  state.scene.buttons.forEach((btn) => {
    let pos = typeof btn.position === "number" ? btn.position : 0;
    if (pos >= maxSlots || occupied.has(pos)) {
      const free = findNextFree();
      pos = free != null ? free : 0;
    }
    btn.position = pos;
    occupied.add(pos);
  });
}

export function selectButton(buttonId) {
  state.selectedButtonId = buttonId;
  renderGrid();
  renderProperties();
}

export function renderGrid() {
  if (!dom.stageGrid) return;
  updateLayoutMode();
  const cells = [];
  const listMode = computeListMode();
  const buildCell = (btn, row, col) => {
    const playerState = state.players.get(btn.id);
    const progressValue =
      playerState && typeof playerState.progress === "number"
        ? Math.max(0, Math.min(1, playerState.progress))
        : 0;
    const isPlaying =
      (playerState?.audio && playerState.audio.paused === false && playerState.audio.ended !== true) ||
      playerState?.isPlaying === true;
    // Диммим кнопку по пометке использования только в перфомансе, в редакторе оставляем цветным
    const isUsedDimmed = state.isPerformance && !isPlaying && Boolean(btn.markUsed && btn.usedOnce);
    const colorBase = btn.color || "#00ffa6";
    const alpha = clampAlpha(btn.colorAlpha ?? 1);
    const effectiveAlpha = isUsedDimmed ? Math.min(alpha, 0.6) : alpha;
    const color = isUsedDimmed ? "#7a7a7a" : colorBase;
    const colorOverlay = applyAlphaToHex(colorBase, effectiveAlpha);
    let playlistInfo = "";
    if (state.isPerformance && btn.playMode === "playlist" && btn.tracks?.length) {
      const playlist = state.playlistState.get(btn.id);
      const total = btn.tracks.length;
      if (btn.playlistMode === "sequential") {
        const nextIdx = ((playlist?.lastIndex ?? -1) + 1) % total;
        playlistInfo = `<div class="stage-type" style="font-size:11px;color:${color};opacity:0.9;">${nextIdx + 1}/${total} следующий</div>`;
      } else {
        playlistInfo = `<div class="stage-type" style="font-size:11px;color:${color};opacity:0.9;">rnd/${total} случайно</div>`;
      }
    }
    const hasPreload =
      state.isPerformance &&
      state.preloadEnabled &&
      (btn.tracks || []).some((t) => state.preloadCache.has(t.id));
    const metaBlock = state.isPerformance
      ? ""
      : `<div class="stage-cell__meta">
            <span class="stage-file">
              <span aria-hidden="true">🔊</span>
              <span class="file-status ${btn.tracks?.length ? "ok" : "missing"}">
                ${btn.tracks?.length ? "✓" : "✕"}
              </span>
            </span>
          </div>`;
    return `
      <div class="stage-cell" data-row="${row}" data-col="${col}">
        <div
          class="stage-cell__btn ${btn.id === state.selectedButtonId ? "stage--selected" : ""} ${
      isPlaying ? "stage--playing" : ""
    } ${isUsedDimmed ? "stage--used" : ""}"
          draggable="${state.isPerformance ? "false" : "true"}"
          data-id="${btn.id}"
          style="--btn-color:${color}; border-color: ${color}55; box-shadow: 0 0 0 1px ${color}30; background: linear-gradient(145deg, ${colorOverlay}, rgba(0,0,0,0.25));"
        >
            ${hasPreload ? '<span class="stage-preload" title="Трек предзагружен"></span>' : ""}
            <div class="stage-label">${btn.label || "Кнопка"}</div>
            <div class="stage-type">${btn.type === "fx" ? "Эффект" : "Музыка"}</div>
            ${playlistInfo}
            ${metaBlock}
          <div class="stage-progress">
            <div class="stage-progress__bar" data-progress="${btn.id}" style="width:${progressValue * 100}%"></div>
          </div>
        </div>
      </div>
    `;
  };

  if (listMode) {
    const ordered = [...state.scene.buttons].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    ordered.forEach((btn, idx) => {
      cells.push(buildCell(btn, Math.floor(idx / state.gridCols), idx % state.gridCols));
    });
  } else {
    for (let row = 0; row < state.gridRows; row += 1) {
      for (let col = 0; col < state.gridCols; col += 1) {
        const btn = getButtonAt(row, col);
        if (btn) {
          cells.push(buildCell(btn, row, col));
        } else {
          const emptyText = state.isPerformance ? "" : "Свободный слот";
          cells.push(`
            <div class="stage-cell" data-row="${row}" data-col="${col}">
              <div class="stage-cell__empty">${emptyText}</div>
            </div>
          `);
        }
      }
    }
  }
  dom.stageGrid.innerHTML = cells.join("");
  resetEmptyDisplay();
  updateLayoutMode();
  ensureButtonContentFits();
  requestAnimationFrame(() => ensureButtonContentFits());
}

export function ensureButtonContentFits() {
  if (!dom.stageGrid) return;
  const buttons = dom.stageGrid.querySelectorAll(".stage-cell__btn");
  const hasOverflow = (el) =>
    Math.max(0, el.scrollHeight - el.clientHeight) > 1 || Math.max(0, el.scrollWidth - el.clientWidth) > 1;
  buttons.forEach((btnEl) => {
    const hideOrder = [
      ...btnEl.querySelectorAll(".stage-cell__meta"),
      ...btnEl.querySelectorAll(".stage-preload"),
      ...btnEl.querySelectorAll(".stage-type"),
    ];
    hideOrder.forEach((el) => {
      el.hidden = false;
    });
    for (const el of hideOrder) {
      if (!hasOverflow(btnEl)) break;
      el.hidden = true;
    }
  });
}

export function updateFadeLabels() {
  if (dom.fadeInLabel) dom.fadeInLabel.textContent = `${dom.fadeInDuration.value} мс`;
  if (dom.fadeOutLabel) dom.fadeOutLabel.textContent = `${dom.fadeOutDuration.value} мс`;
}

const clampAlpha = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return 1;
  return Math.max(0, Math.min(1, num));
};

const applyAlphaToHex = (hex, alpha = 1) => {
  const safeHex = (hex || "").trim();
  const match = safeHex.match(/^#?([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/);
  if (!match) return `rgba(0,255,166,${alpha})`;
  let value = match[1];
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = parseInt(value, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const updateColorAlphaLabel = () => {
  if (!dom.inputColorAlpha || !dom.inputColorAlphaValue) return;
  const val = clampAlpha(dom.inputColorAlpha.value);
  dom.inputColorAlpha.value = val;
  dom.inputColorAlphaValue.textContent = `${Math.round(val * 100)}%`;
};

let playlistExpanded = false;

function setPlaylistExpanded(expanded) {
  if (dom.playlistList) {
    dom.playlistList.classList.toggle("playlist__list--expanded", expanded);
  }
  if (dom.playlistExpandBtn) {
    dom.playlistExpandBtn.textContent = expanded ? "Свернуть" : "Показать весь";
    dom.playlistExpandBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
  }
}

export function resetPlaylistExpanded() {
  playlistExpanded = false;
  setPlaylistExpanded(playlistExpanded);
}

export function togglePlaylistExpanded() {
  playlistExpanded = !playlistExpanded;
  setPlaylistExpanded(playlistExpanded);
}

function stopTrackPreview(trackId) {
  const entry = state.trackPreviews.get(trackId);
  if (!entry?.audio) {
    state.trackPreviews.delete(trackId);
    return;
  }
  entry.audio.pause();
  entry.audio.currentTime = 0;
  state.trackPreviews.delete(trackId);
}

function stopAllTrackPreviews() {
  Array.from(state.trackPreviews.keys()).forEach((id) => stopTrackPreview(id));
}

export async function togglePlaylistPreview(trackId) {
  if (!ensureApi() || !state.currentProject || !state.selectedButtonId) return;
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn?.tracks) return;
  const track = btn.tracks.find((t) => t.id === trackId);
  if (!track?.file) return;
  if (state.trackPreviews.has(trackId)) {
    stopTrackPreview(trackId);
    renderPlaylist();
    return;
  }
  stopAllTrackPreviews();
  try {
    const url = await resolveTrackUrl(btn, track);
    const audio = new Audio(url);
    state.trackPreviews.set(trackId, { audio });
    audio.addEventListener("ended", () => {
      stopTrackPreview(trackId);
      renderPlaylist();
    });
    await audio.play();
  } catch (err) {
    stopTrackPreview(trackId);
  }
  renderPlaylist();
}

export function updatePlayModeVisibility(mode) {
  const isPlaylist = mode === "playlist";
  if (dom.playlistControls) dom.playlistControls.toggleAttribute("hidden", !isPlaylist);
  if (dom.playlistMode) dom.playlistMode.disabled = !isPlaylist;
  if (dom.repeatGapInput) dom.repeatGapInput.disabled = !isPlaylist;
}

export function renderPlaylist() {
  if (!dom.playlistList) return;
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn) {
    dom.playlistList.innerHTML = "";
    return;
  }
  if (!btn.tracks || !btn.tracks.length) {
    dom.playlistList.innerHTML = `<div class="hint">Добавьте треки в плейлист</div>`;
    return;
  }
  const soloMode = btn.playMode === "solo";
  dom.playlistList.innerHTML = btn.tracks
    .map((track, idx) => {
      const disabledClass = soloMode && idx > 0 ? "disabled" : "";
      const title = baseName(track.label || track.file || "Трек");
      const previewPlaying = state.trackPreviews.has(track.id);
      return `
        <div class="playlist__item ${disabledClass}" draggable="true" data-track-id="${track.id}">
          <div class="playlist__item-head">
            <span class="playlist__item-index">${idx + 1}</span>
            <span class="drag-handle" aria-hidden="true">↕</span>
            <span class="playlist__item-title" title="${title}">${title}</span>
          </div>
          <div class="playlist__item-actions">
            <button class="btn small secondary playlist__btn" data-track-preview="${track.id}">
              ${previewPlaying ? "STOP" : "PLAY"}
            </button>
            <button class="btn small secondary playlist__btn" data-track-select="${track.id}">SEL</button>
            <button class="btn danger small playlist__btn" data-track-delete="${track.id}">✕</button>
          </div>
        </div>
      `;
    })
    .join("");
  if (!state.isPerformance) {
    // Обновляем сетку, чтобы сразу подсветить наличие/отсутствие треков
    renderGrid();
  }
}

function renderPlaylistPickerList(btn) {
  if (!dom.playlistPickList) return;
  const tracks = btn?.tracks || [];
  if (!tracks.length) {
    dom.playlistPickList.innerHTML = `<div class="playlist-pick__empty">Плейлист пуст</div>`;
    return;
  }
  dom.playlistPickList.innerHTML = tracks
    .map((track, idx) => {
      const title = baseName(track.label || track.file || "Трек");
      return `
        <button class="playlist-pick__item" type="button" data-track-id="${track.id}" data-track-index="${idx}">
          <span class="playlist-pick__index">${idx + 1}</span>
          <span class="playlist-pick__title" title="${title}">${title}</span>
        </button>
      `;
    })
    .join("");
}

export function closePlaylistPicker() {
  state.playlistPickerButtonId = null;
  if (dom.playlistPickModal) dom.playlistPickModal.hidden = true;
  if (dom.playlistPickList) dom.playlistPickList.innerHTML = "";
}

export function openPlaylistPicker(buttonId) {
  if (!state.isPerformance) return false;
  const btn = state.scene.buttons.find((b) => b.id === buttonId);
  if (!btn || btn.playMode !== "playlist" || !btn.tracks?.length) {
    if (dom.propertiesError) dom.propertiesError.textContent = "Плейлист пуст или не задан.";
    return false;
  }
  state.playlistPickerButtonId = buttonId;
  if (dom.playlistPickTitle) dom.playlistPickTitle.textContent = btn.label || "Плейлист";
  if (dom.playlistPickSubtitle) dom.playlistPickSubtitle.textContent = `${btn.tracks.length} трек(ов)`;
  renderPlaylistPickerList(btn);
  if (dom.playlistPickModal) dom.playlistPickModal.hidden = false;
  return true;
}

export function renderProperties() {
  updateFadeLabels();
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn) {
    if (dom.slotLabel) dom.slotLabel.textContent = "СЛОТ —";
    if (dom.inputLabel) dom.inputLabel.value = "";
    if (dom.inputType) dom.inputType.value = "music";
    if (dom.fadeInToggle) dom.fadeInToggle.checked = false;
    if (dom.fadeOutToggle) dom.fadeOutToggle.checked = false;
    if (dom.fadeInDuration) dom.fadeInDuration.value = 0;
    if (dom.fadeOutDuration) dom.fadeOutDuration.value = 0;
    if (dom.playlistList) dom.playlistList.innerHTML = `<div class="hint">Добавьте треки в плейлист</div>`;
    if (dom.inputOnClick) dom.inputOnClick.value = "restart";
  if (dom.inputPlayMode) dom.inputPlayMode.value = "solo";
  if (dom.inputAudioGroup) dom.inputAudioGroup.value = "0";
    if (dom.inputColor) dom.inputColor.value = "#00ffa6";
    if (dom.inputColorValue) dom.inputColorValue.value = "#00ffa6";
    if (dom.inputColorAlpha) dom.inputColorAlpha.value = 1;
    updateColorAlphaLabel();
    if (dom.inputMarkUsageSelect) dom.inputMarkUsageSelect.value = "mark";
    updatePlayModeVisibility("solo");
    resetPlaylistExpanded();
    stopAllTrackPreviews();
    renderPlaylist();
    if (dom.propertiesError) dom.propertiesError.textContent = "Выберите кнопку в сетке или добавьте новую.";
    return;
  }
  if (dom.slotLabel) dom.slotLabel.textContent = `СЛОТ ${btn.position + 1}`;
  if (dom.inputLabel) dom.inputLabel.value = btn.label || "";
  if (dom.inputType) dom.inputType.value = btn.type || "music";
  if (dom.fadeInToggle) dom.fadeInToggle.checked = (btn.fadeIn || 0) > 0;
  if (dom.fadeOutToggle) dom.fadeOutToggle.checked = (btn.fadeOut || 0) > 0;
  if (dom.fadeInDuration) dom.fadeInDuration.value = btn.fadeIn || 0;
  if (dom.fadeOutDuration) dom.fadeOutDuration.value = btn.fadeOut || 0;
  if (dom.inputOnClick) dom.inputOnClick.value = btn.onClickBehavior || "restart";
  if (dom.inputPlayMode) dom.inputPlayMode.value = btn.playMode || "solo";
  if (dom.inputAudioGroup)
    dom.inputAudioGroup.value = String(typeof btn.audioGroup === "number" ? clampGroupIndex(btn.audioGroup) : 0);
  if (dom.playlistMode) dom.playlistMode.value = btn.playlistMode || "sequential";
  if (dom.repeatGapInput) dom.repeatGapInput.value = typeof btn.repeatGap === "number" ? btn.repeatGap : 0;
  if (dom.inputColor) dom.inputColor.value = btn.color || "#00ffa6";
  if (dom.inputColorValue) dom.inputColorValue.value = dom.inputColor.value;
  if (dom.inputColorAlpha) dom.inputColorAlpha.value = clampAlpha(btn.colorAlpha ?? 1);
  updateColorAlphaLabel();
  if (dom.inputMarkUsageSelect) dom.inputMarkUsageSelect.value = btn.markUsed ? "mark" : "skip";
  updatePlayModeVisibility(btn.playMode || "solo");
  resetPlaylistExpanded();
  stopAllTrackPreviews();
  renderPlaylist();
  updateFadeLabels();
  if (dom.propertiesError) dom.propertiesError.textContent = "";
}

export function findFirstFreeSlot() {
  for (let row = 0; row < state.gridRows; row += 1) {
    for (let col = 0; col < state.gridCols; col += 1) {
      if (!getButtonAt(row, col)) {
        return { row, col };
      }
    }
  }
  return null;
}

export function handleAddButton() {
  if (state.isPerformance) return;
  const free = findFirstFreeSlot();
  if (!free) {
    if (dom.propertiesError)
      dom.propertiesError.textContent = `Все слоты заняты (${state.gridCols}×${state.gridRows}). Удалите кнопку, чтобы освободить место.`;
    return;
  }
  const newBtn = {
    id: `btn_${Date.now()}`,
    label: "Кнопка",
    type: "music",
    file: "",
    fadeIn: 0,
    fadeOut: 0,
    onClickBehavior: "stop",
    playMode: "solo",
    playlistMode: "sequential",
    repeatGap: 0,
    tracks: [],
    color: "#00ffa6",
    colorAlpha: 1,
    audioGroup: 0,
    position: getPositionIndex(free.row, free.col),
    markUsed: true,
    usedOnce: false,
  };
  state.scene.buttons.push(newBtn);
  selectButton(newBtn.id);
  setSceneDirty(true);
}

export function handleCreateAtSlot(row, col) {
  if (state.isPerformance) return;
  const existing = getButtonAt(row, col);
  if (existing) {
    selectButton(existing.id);
    return;
  }
  const newBtn = {
    id: `btn_${Date.now()}`,
    label: "Кнопка",
    type: "music",
    file: "",
    fadeIn: 0,
    fadeOut: 0,
    onClickBehavior: "stop",
    playMode: "solo",
    playlistMode: "sequential",
    repeatGap: 0,
    tracks: [],
    color: "#00ffa6",
    colorAlpha: 1,
    audioGroup: 0,
    position: getPositionIndex(row, col),
    markUsed: true,
    usedOnce: false,
  };
  state.scene.buttons.push(newBtn);
  selectButton(newBtn.id);
  setSceneDirty(true);
}

export function moveButton(buttonId, targetRow, targetCol) {
  const btn = state.scene.buttons.find((b) => b.id === buttonId);
  if (!btn) return;
  const occupying = getButtonAt(targetRow, targetCol);
  if (occupying && occupying.id !== buttonId) {
    occupying.position = btn.position;
  }
  btn.position = getPositionIndex(targetRow, targetCol);
  renderGrid();
  setSceneDirty(true);
}

export function duplicateButton(buttonId, targetRow, targetCol) {
  const btn = state.scene.buttons.find((b) => b.id === buttonId);
  if (!btn) return;
  const occupying = getButtonAt(targetRow, targetCol);
  if (occupying) return;
  const newBtn = {
    ...btn,
    id: `btn_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    position: getPositionIndex(targetRow, targetCol),
    tracks: (btn.tracks || []).map((t) => ({
      ...t,
      id: `track_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      segment: t.segment ? { ...t.segment } : undefined,
    })),
    markUsed: Boolean(btn.markUsed),
    usedOnce: false,
  };
  state.scene.buttons.push(newBtn);
  selectButton(newBtn.id);
  renderGrid();
  setSceneDirty(true);
}

export async function importButtonFromProject(payload, targetRow, targetCol) {
  if (!ensureApi() || !state.currentProject || !payload?.button || !payload?.projectId) return;
  const sourceProjectId = payload.projectId;
  const targetProjectId = state.currentProject.id;
  if (!sourceProjectId || sourceProjectId === targetProjectId) return;

  const occupying = getButtonAt(targetRow, targetCol);
  if (occupying) {
    const free = findFirstFreeSlot();
    if (!free) {
      if (dom.propertiesError) dom.propertiesError.textContent = "Нет свободного слота для переноса.";
      return;
    }
    occupying.position = getPositionIndex(free.row, free.col);
  }

  const copyTrack = async (track) => {
    const nextTrack = {
      ...track,
      id: `track_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      segment: track?.segment ? { ...track.segment } : undefined,
      normalizedFile: "",
      useNormalized: false,
    };
    if (track?.file) {
      try {
        const rel = await window.stagepadAPI.copyProjectAsset(sourceProjectId, targetProjectId, track.file);
        nextTrack.file = rel;
      } catch (error) {
        console.error("Не удалось перенести файл трека:", error);
        nextTrack.file = "";
      }
    }
    return nextTrack;
  };

  const srcBtn = payload.button;
  const newTracks = Array.isArray(srcBtn.tracks) ? await Promise.all(srcBtn.tracks.map(copyTrack)) : [];
  const newBtn = {
    ...srcBtn,
    id: `btn_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    position: getPositionIndex(targetRow, targetCol),
    tracks: newTracks,
    usedOnce: false,
    file: "",
  };
  state.scene.buttons.push(newBtn);
  selectButton(newBtn.id);
  renderGrid();
  renderProperties();
  setSceneDirty(true);
}

export function sortButtonsByName() {
  if (state.isPerformance) return;
  const sorted = [...state.scene.buttons].sort((a, b) => {
    const aName = (a?.label || "").toString().toLowerCase();
    const bName = (b?.label || "").toString().toLowerCase();
    return aName.localeCompare(bName, "ru", { sensitivity: "base", numeric: true });
  });
  sorted.forEach((btn, idx) => {
    btn.position = idx;
  });
  state.scene.buttons = sorted;
  clampButtonsToGrid();
  renderGrid();
  renderProperties();
  setSceneDirty(true);
}

export function updateButtonField(field, value) {
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn) return;
  if (field === "colorAlpha") {
    btn[field] = clampAlpha(value);
    updateColorAlphaLabel();
  } else if (field === "audioGroup") {
    btn.audioGroup = clampGroupIndex(value);
    const entry = state.players.get(btn.id);
    if (entry?.audio) {
      entry.group = btn.audioGroup;
      applyGroupVolume(entry);
      attachEntryToGroupMeter(entry);
    }
  } else {
    btn[field] = value;
  }
  if (field === "fadeIn" || field === "fadeOut") {
    updateFadeLabels();
  }
  if (field === "playMode") {
    updatePlayModeVisibility(value);
  }
  if (field === "color" && dom.inputColorValue) {
    dom.inputColorValue.value = value;
  }
  if (field === "color" && dom.inputColor) {
    dom.inputColor.value = value;
  }
  if (field === "markUsed" && dom.inputMarkUsageSelect) {
    dom.inputMarkUsageSelect.value = value ? "mark" : "skip";
  }
  renderGrid();
  setSceneDirty(true);
}

export function resetUsageFlags() {
  (state.scene.buttons || []).forEach((btn) => {
    if (btn) btn.usedOnce = false;
  });
}

export async function loadScene(project) {
  if (!ensureApi()) return;
  state.currentProject = project;
  state.selectedButtonId = null;
  state.scene = await window.stagepadAPI.loadScene(project.id);
  // Предзагрузка привязана к проекту: берем флаг из метаданных, иначе используем старый глобальный фолбэк
  const scenePerf = state.scene?.perfSettings || {};
  const normalizeClickAction = (action, fallback = "restart") => {
    return ["restart", "pause", "stop", "open-playlist"].includes(action) ? action : fallback;
  };
  const middleLocal = localStorage.getItem("stagepadPerfClickMiddle");
  const rightLocal = localStorage.getItem("stagepadPerfClickRight");
  let localProjectClicks = null;
  try {
    localProjectClicks = JSON.parse(localStorage.getItem(`stagepadPerfClicks_${project?.id}`) || "null");
  } catch (error) {
    localProjectClicks = null;
  }
  state.preloadEnabled =
    scenePerf.preloadEnabled != null
      ? Boolean(scenePerf.preloadEnabled)
      : project?.perfPreloadEnabled != null
      ? Boolean(project.perfPreloadEnabled)
      : localStorage.getItem("stagepadPreloadEnabled") === "1";
  state.perfClickMiddleAction = normalizeClickAction(
    scenePerf.clickMiddle ?? project?.perfClickMiddleAction ?? localProjectClicks?.middle ?? middleLocal,
    state.perfClickMiddleAction || "restart"
  );
  state.perfClickRightAction = normalizeClickAction(
    scenePerf.clickRight ?? project?.perfClickRightAction ?? localProjectClicks?.right ?? rightLocal,
    state.perfClickRightAction || "open-playlist"
  );
  state.perfFontSize = Math.max(
    10,
    Math.min(32, Number(scenePerf.perfFontSize ?? project?.perfFontSize ?? state.perfFontSize) || state.perfFontSize || 18)
  );
  state.perfDefaultListMode =
    scenePerf.perfDefaultListMode != null
      ? Boolean(scenePerf.perfDefaultListMode)
      : project?.perfDefaultListMode != null
      ? Boolean(project.perfDefaultListMode)
      : state.perfDefaultListMode;
  state.perfListMode = state.perfDefaultListMode;
  state.perfAlwaysOnTop =
    scenePerf.perfAlwaysOnTop != null
      ? Boolean(scenePerf.perfAlwaysOnTop)
      : project?.perfAlwaysOnTop != null
      ? Boolean(project.perfAlwaysOnTop)
      : state.perfAlwaysOnTop;
  if (state.currentProject) {
    state.currentProject.perfClickMiddleAction = state.perfClickMiddleAction;
    state.currentProject.perfClickRightAction = state.perfClickRightAction;
    state.currentProject.perfDefaultListMode = state.perfDefaultListMode;
    state.currentProject.perfAlwaysOnTop = state.perfAlwaysOnTop;
    state.currentProject.perfFontSize = state.perfFontSize;
    state.currentProject.perfPreloadEnabled = state.preloadEnabled;
  }
  if (state.isPerformance && state.currentProject?.id) {
    localStorage.setItem(ACTIVE_PERF_PROJECT_KEY, state.currentProject.id);
  }
  const sceneGrid = state.scene?.grid || {};
  state.gridRows = Math.max(1, Math.min(20, Number(sceneGrid.rows) || DEFAULT_ROWS));
  state.gridCols = Math.max(1, Math.min(20, Number(sceneGrid.cols) || DEFAULT_COLS));
  applyGridCss();
  // Синхронизируем действия кликов с кешом проекта в списке, чтобы они не терялись между загрузками
  const cachedProject = state.projects.find((p) => p.id === project.id);
  if (cachedProject) {
    cachedProject.perfClickMiddleAction = state.perfClickMiddleAction;
    cachedProject.perfClickRightAction = state.perfClickRightAction;
    cachedProject.perfDefaultListMode = state.perfDefaultListMode;
    cachedProject.perfAlwaysOnTop = state.perfAlwaysOnTop;
    cachedProject.perfFontSize = state.perfFontSize;
    cachedProject.perfPreloadEnabled = state.preloadEnabled;
  }
    state.scene.buttons = (state.scene.buttons || []).map((btn, idx) => ({
    onClickBehavior: "restart",
    playMode: "solo",
    playlistMode: "sequential",
    repeatGap: 0,
    tracks: [],
    color: "#00ffa6",
    audioGroup: 0,
    ...btn,
    position: typeof btn.position === "number" ? btn.position : idx,
    repeatGap: typeof btn.repeatGap === "number" ? btn.repeatGap : 0,
    tracks: Array.isArray(btn.tracks) ? btn.tracks : [],
    color: btn.color || "#00ffa6",
    markUsed: Boolean(btn.markUsed),
    usedOnce: Boolean(btn.usedOnce),
    audioGroup: typeof btn.audioGroup === "number" ? clampGroupIndex(btn.audioGroup) : 0,
  }));
  state.scene.buttons.forEach((btn) => {
    if (Array.isArray(btn.tracks)) {
      btn.tracks = btn.tracks.map((track) => ({
        ...track,
        loudnessGainDb: Number.isFinite(track?.loudnessGainDb) ? Number(track.loudnessGainDb) : 0,
        normalizedFile: typeof track?.normalizedFile === "string" ? track.normalizedFile : "",
        useNormalized: Boolean(track?.useNormalized && track?.normalizedFile),
      }));
    }
    if ((!btn.tracks || !btn.tracks.length) && btn.file) {
      btn.tracks = [
        {
          id: `track_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          file: btn.file,
          label: btn.file,
          loudnessGainDb: 0,
          normalizedFile: "",
          useNormalized: false,
        },
      ];
    }
  });
  clampButtonsToGrid();
  if (state.scene.buttons.length > 0) {
    state.selectedButtonId = state.scene.buttons[0].id;
  } else {
    state.selectedButtonId = null;
  }
  if (dom.editorTitle) dom.editorTitle.textContent = project.name;
  if (dom.editorSubtitle) dom.editorSubtitle.textContent = project.description || `ID: ${project.id}`;
  if (dom.editorBadge) dom.editorBadge.textContent = state.isPerformance ? project.name : "Редактор";
  renderGrid();
  renderProperties();
  renderPlayingStack();
  setSceneDirty(false);
  ensureProjectGroupSync();
  if (state.isPerformance) {
    updatePreloadButtonUI();
  }
  if (state.isPerformance && state.preloadEnabled) {
    primePreloadForScene();
  }
}

export async function saveScene() {
  if (!ensureApi()) return;
  if (!state.currentProject) return;
  if (state.isPerformance) {
    state.scene.perfSettings = {
      ...(state.scene.perfSettings || {}),
      clickMiddle: state.perfClickMiddleAction,
      clickRight: state.perfClickRightAction,
      preloadEnabled: state.preloadEnabled,
      perfFontSize: state.perfFontSize,
      perfDefaultListMode: state.perfDefaultListMode,
      perfAlwaysOnTop: state.perfAlwaysOnTop,
    };
  }
  await window.stagepadAPI.saveScene(state.currentProject.id, {
    buttons: state.scene.buttons,
    grid: { rows: state.gridRows, cols: state.gridCols },
    perfSettings: state.scene.perfSettings,
  });
  setSceneDirty(false);
  if (dom.propertiesError) {
    dom.propertiesError.textContent = "Сцена сохранена.";
    dom.propertiesError.style.color = "#00ffa6";
    setTimeout(() => {
      if (dom.propertiesError) {
        dom.propertiesError.textContent = "";
        dom.propertiesError.style.color = "";
      }
    }, 1500);
  }
}

export async function persistUsageFlags() {
  if (!ensureApi() || !state.currentProject) return;
  await window.stagepadAPI.saveScene(state.currentProject.id, {
    buttons: state.scene.buttons,
    grid: { rows: state.gridRows, cols: state.gridCols },
  });
}

export function stopAudio(buttonId, { force = false, targetAudio = null, targetTrackId = null, fadeLimit = null } = {}) {
  const existing = state.players.get(buttonId);
  const btn = state.scene.buttons.find((b) => b.id === buttonId);
  const audio = targetAudio || existing?.audio;
  const trackId = targetTrackId ?? existing?.trackId;
  if (DEBUG_LOOP && existing?.segment?.loop) {
    console.warn("[stagepad][loop] stopAudio", {
      buttonId,
      trackId,
      force,
      fadeLimit,
      hasAudio: Boolean(audio),
      segment: existing.segment,
    });
  }

  const btnFadeOut = Math.max(0, Number(btn?.fadeOut) || 0);
  const limitedFadeOut = fadeLimit != null ? Math.min(btnFadeOut, Math.max(0, Number(fadeLimit) || 0)) : btnFadeOut;
  const canFade = !force && limitedFadeOut > 0 && audio && !(existing?.stopping && audio === existing.audio);

  if (canFade) {
    if (existing) existing.stopping = true;
    if (existing?.audio && audio === existing.audio) {
      const fromBase = Number.isFinite(existing.baseVolume) ? existing.baseVolume : audio.volume;
      fadeEntryVolume(existing, fromBase, 0, limitedFadeOut, () =>
        stopAudio(buttonId, { force: true, targetAudio: audio, targetTrackId: trackId })
      );
    } else {
      fadeAudio(
        audio,
        audio.volume,
        0,
        limitedFadeOut,
        () => stopAudio(buttonId, { force: true, targetAudio: audio, targetTrackId: trackId })
      );
    }
    return;
  }

  if (audio) {
    try {
      audio.pause();
    } catch (_) {
      /* ignore */
    }
  }
  const shouldClearPlayer = existing && (!targetAudio || existing.audio === targetAudio);
  if (shouldClearPlayer) {
    detachEntryFromMeter(existing);
    state.players.delete(buttonId);
    updateProgressVisual(buttonId, 0, false);
    renderPlayingStack();
    if (trackId) {
      releaseAfterPlayback(trackId, btn);
    }
  } else if (trackId) {
    // Снимаем ресурсы со старого трека, но не трогаем актуальный плеер
    releaseAfterPlayback(trackId, btn);
  }
}

export function stopAllAudio() {
  state.players.forEach((value, id) => {
    if (value?.audio) {
      value.audio.pause();
    }
    detachEntryFromMeter(value);
    state.players.delete(id);
    updateProgressVisual(id, 0, false);
    if (value?.trackId) {
      const btn = state.scene.buttons.find((b) => b.id === id);
      releaseAfterPlayback(value.trackId, btn);
    }
  });
  renderPlayingStack();
}

export function stopMusicPlayers(exceptId, { smooth = true, fadeLimit = null, force = false, skipUndo = false } = {}) {
  state.scene.buttons.forEach((btn) => {
    if (btn.type === "music" && btn.id !== exceptId) {
      const entry = state.players.get(btn.id);
      if (!skipUndo && entry?.audio && !entry.audio.paused) {
        captureUndoFromEntry(btn.id, entry);
      }
      stopAudio(btn.id, {
        targetAudio: entry?.audio || null,
        targetTrackId: entry?.trackId,
        fadeLimit,
        force,
      });
    }
  });
}

export function clearPreloadCache(options = {}) {
  const { skipActive = false } = options;
  const activeIds = skipActive
    ? new Set(
        Array.from(state.players.values())
          .map((p) => p.trackId)
          .filter(Boolean)
      )
    : null;
  state.preloadCache.forEach((entry, id) => {
    if (skipActive && activeIds?.has(id)) {
      // оставляем до стопа, но не держим вечно
      entry.keep = false;
      return;
    }
    if (entry?.url && entry.revoke) URL.revokeObjectURL(entry.url);
    state.preloadCache.delete(id);
  });
  state.preloadPromises.clear();
  if (state.isPerformance) renderGrid();
}

export function togglePreload(enabled) {
  state.preloadEnabled = enabled;
  localStorage.setItem("stagepadPreloadEnabled", enabled ? "1" : "0");
  if (ensureApi() && state.currentProject) {
    state.currentProject.perfPreloadEnabled = enabled;
    const cachedProject = state.projects.find((p) => p.id === state.currentProject.id);
    if (cachedProject) {
      cachedProject.perfPreloadEnabled = enabled;
    }
    if (state.isPerformance && state.scene) {
      state.scene.perfSettings = {
        ...(state.scene.perfSettings || {}),
        preloadEnabled: enabled,
      };
    }
    try {
      const result = window.stagepadAPI?.setProjectPreloadEnabled?.(state.currentProject.id, enabled);
      if (result?.then) {
        result.catch((error) => console.error("Не удалось сохранить настройку предзагрузки проекта:", error));
      }
    } catch (error) {
      console.error("Не удалось сохранить настройку предзагрузки проекта:", error);
    }
  }
  updatePreloadButtonUI();
  if (!enabled) clearPreloadCache({ skipActive: true });
  if (enabled) {
    primePreloadForScene();
  }
  if (state.isPerformance) renderGrid();
}

async function preloadTrack(btn, track) {
  if (!state.preloadEnabled || !track?.file || !state.currentProject) return null;
  const cached = state.preloadCache.get(track.id);
  if (cached) {
    if (cached.readyPromise) {
      await cached.readyPromise.catch(() => {});
    }
    return cached.url;
  }
  if (state.preloadPromises.has(track.id)) {
    return state.preloadPromises.get(track.id);
  }

  const waitAudioReady = (src) =>
    new Promise((resolve, reject) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      const cleanup = () => {
        audio.removeEventListener("canplaythrough", onReady);
        audio.removeEventListener("loadeddata", onReady);
        audio.removeEventListener("error", onErr);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onErr = (err) => {
        cleanup();
        reject(err);
      };
      audio.addEventListener("canplaythrough", onReady, { once: true });
      audio.addEventListener("loadeddata", onReady, { once: true });
      audio.addEventListener("error", onErr, { once: true });
      audio.load();
    });

  const task = (async () => {
    const fileUrl = window.stagepadAPI.getAssetFileUrl(state.currentProject.id, getPlaybackFile(track));
    let preloadSrc = fileUrl;
    let shouldRevoke = false;
    let readyPromise = null;
    try {
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      preloadSrc = URL.createObjectURL(new Blob([arrayBuffer]));
      shouldRevoke = true;
      readyPromise = waitAudioReady(preloadSrc);
    } catch (err) {
      // Если не получилось через fetch (например, file://), пробуем прогреть напрямую
      preloadSrc = fileUrl;
      readyPromise = waitAudioReady(fileUrl);
    }
    state.preloadCache.set(track.id, {
      url: preloadSrc,
      keep: btn.playMode === "solo",
      readyPromise,
      revoke: shouldRevoke,
    });
    await readyPromise.catch(() => {});
    if (state.isPerformance) renderGrid();
    return preloadSrc;
  })()
    .catch((err) => {
      state.preloadCache.delete(track.id);
      throw err;
    })
    .finally(() => state.preloadPromises.delete(track.id));
  state.preloadPromises.set(track.id, task);
  return task;
}

function releaseTrackCache(trackId, force = false) {
  const entry = state.preloadCache.get(trackId);
  if (!entry) return;
  if (force || !entry.keep || !state.preloadEnabled) {
    if (entry.url && entry.revoke) URL.revokeObjectURL(entry.url);
    state.preloadCache.delete(trackId);
    state.preloadPromises.delete(trackId);
    if (state.isPerformance) renderGrid();
  }
}

async function resolveTrackUrl(btn, track) {
  if (state.preloadEnabled) {
    const url = await preloadTrack(btn, track);
    if (url) return url;
  }
  return window.stagepadAPI.getAssetFileUrl(state.currentProject.id, getPlaybackFile(track));
}

function releaseAfterPlayback(trackId, btn) {
  if (!trackId) return;
  const keep = state.preloadEnabled && btn?.playMode === "solo";
  if (!keep) releaseTrackCache(trackId, true);
}

function computeRandomNextIndex(btn, stateEntry) {
  const gap = Math.max(0, btn.repeatGap || 0);
  const history = stateEntry?.history || [];
  const pool = btn.tracks.map((_, idx) => idx);
  const blacklist = history.slice(-gap);
  const candidates = pool.filter((idx) => !blacklist.includes(idx));
  const pickPool = candidates.length ? candidates : pool;
  return pickPool[Math.floor(Math.random() * pickPool.length)];
}

function primePreloadForScene() {
  if (!state.preloadEnabled || !state.isPerformance) return;
  const tasks = [];
  state.scene.buttons.forEach((btn) => {
    if (!btn.tracks?.length) return;
    if (btn.playMode === "solo") {
      tasks.push(preloadTrack(btn, btn.tracks[0]));
    } else if (btn.playMode === "playlist") {
      const idx =
        btn.playlistMode === "sequential"
          ? 0
          : computeRandomNextIndex(btn, { history: [], lastIndex: -1 });
      tasks.push(preloadTrack(btn, btn.tracks[idx]));
      const entry = state.playlistState.get(btn.id) || { lastIndex: -1, history: [] };
      entry.preloadNext = idx;
      state.playlistState.set(btn.id, entry);
    }
  });
  Promise.allSettled(tasks).then(() => {
    if (state.isPerformance) renderGrid();
  });
}

function prefetchNextTrack(buttonId, btn, currentIndex) {
  if (!state.preloadEnabled || !btn.tracks?.length) return;
  let nextIndex = currentIndex;
  if (btn.playlistMode === "sequential") {
    nextIndex = (currentIndex + 1) % btn.tracks.length;
  } else {
    const entry = state.playlistState.get(buttonId) || { lastIndex: currentIndex, history: [currentIndex] };
    nextIndex = computeRandomNextIndex(btn, entry);
  }
  if (nextIndex === currentIndex) return;
  preloadTrack(btn, btn.tracks[nextIndex]);
  const entry = state.playlistState.get(buttonId) || {};
  entry.preloadNext = nextIndex;
  state.playlistState.set(buttonId, entry);
}

export function fadeAudio(audio, from, to, duration, onDone) {
  if (duration <= 0) {
    audio.volume = to;
    if (onDone) onDone();
    return;
  }
  const steps = Math.max(1, Math.round(duration / 50));
  const delta = (to - from) / steps;
  let current = from;
  audio.volume = from;
  const timer = setInterval(() => {
    current += delta;
    audio.volume = Math.min(1, Math.max(0, current));
    if ((delta > 0 && audio.volume >= to) || (delta < 0 && audio.volume <= to)) {
      clearInterval(timer);
      audio.volume = to;
      if (onDone) onDone();
    }
  }, 50);
}

export function updateProgressVisual(buttonId, progress, isPlaying) {
  const bar = dom.stageGrid?.querySelector(`.stage-progress__bar[data-progress="${buttonId}"]`);
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }
  const card = dom.stageGrid?.querySelector(`.stage-cell__btn[data-id="${buttonId}"]`);
  if (card) {
    if (isPlaying) {
      card.classList.add("stage--playing");
    } else {
      card.classList.remove("stage--playing");
    }
  }
}

export function pickPlaylistTrack(buttonId, btn) {
  const tracks = btn.tracks || [];
  if (!tracks.length) return null;
  const stateEntry = state.playlistState.get(buttonId) || { lastIndex: -1, history: [] };
  if (stateEntry.preloadNext != null && tracks[stateEntry.preloadNext]) {
    const idx = stateEntry.preloadNext;
    state.playlistState.set(buttonId, { lastIndex: idx, history: stateEntry.history || [] });
    stateEntry.preloadNext = null;
    return { index: idx, track: tracks[idx] };
  }
  let nextIndex = 0;
  if (btn.playlistMode === "sequential") {
    nextIndex = (stateEntry.lastIndex + 1) % tracks.length;
  } else {
    nextIndex = computeRandomNextIndex(btn, stateEntry);
    const gap = Math.max(0, btn.repeatGap || 0);
    const history = stateEntry.history || [];
    stateEntry.history = [...history, nextIndex].slice(-(gap + 1));
  }
  state.playlistState.set(buttonId, { lastIndex: nextIndex, history: stateEntry.history || [] });
  return { index: nextIndex, track: tracks[nextIndex] };
}

export function renderPlayingStack() {
  if (!dom.playingListEl) return;
  const active = [];
  state.players.forEach((value, id) => {
    if (value?.audio && !value.audio.paused) {
      active.push({
        id,
        track: "",
        label: value.buttonLabel || "Кнопка",
        status: value.audio.paused ? "Пауза" : "Играет",
        fade: value.fadeLabel || "",
      });
    }
  });
  if (!active.length) {
    const empty = `<div class="hint">Ничего не играет</div>`;
    dom.playingListEl.innerHTML = empty;
    if (dom.playingFloatingEl) dom.playingFloatingEl.innerHTML = empty;
    if (dom.playingModalList) dom.playingModalList.innerHTML = empty;
    publishActiveGroups();
    return;
  }
  const html = active
    .map(
      (item) => `
      <div class="playing-item" data-playing-id="${item.id}" title="Двойной клик — фейд-аут, тройной — стоп">
        <div class="playing-item__meta">
          <span class="playing-item__label">${item.label}</span>
          <span class="playing-item__sub">${item.status}${item.fade ? " · " + item.fade : ""}</span>
        </div>
        <span class="chip">▶</span>
      </div>
    `
    )
    .join("");
  dom.playingListEl.innerHTML = html;
  if (dom.playingFloatingEl) dom.playingFloatingEl.innerHTML = html;
  if (dom.playingModalList) dom.playingModalList.innerHTML = html;
  publishActiveGroups();
}

export function fadeOutAndStop(buttonId, duration = 2000) {
  const entry = state.players.get(buttonId);
  if (!entry?.audio) return;
  const fromBase = Number.isFinite(entry.baseVolume) ? entry.baseVolume : entry.audio.volume;
  fadeEntryVolume(entry, fromBase, 0, duration, () =>
    stopAudio(buttonId, { force: true, targetAudio: entry.audio, targetTrackId: entry.trackId })
  );
}

const captureUndoFromEntry = (buttonId, entry) => {
  if (!entry?.audio) return;
  let time = Number.isFinite(entry.lastTime) ? entry.lastTime : null;
  if (!Number.isFinite(time)) {
    time = Number.isFinite(entry.audio?.currentTime) ? entry.audio.currentTime : null;
  }
  if (!Number.isFinite(time)) {
    const seg = entry.segment;
    const progress = Number.isFinite(entry.progress) ? entry.progress : 0;
    const segStart = seg?.start || 0;
    const segEnd = Number.isFinite(seg?.end) && seg.end > segStart ? seg.end : segStart;
    const length = Math.max(0, segEnd - segStart);
    time = length > 0 ? segStart + length * progress : 0;
  }
  state.lastMusicUndo = {
    buttonId,
    trackId: entry.trackId || null,
    time: Math.max(0, Number(time) || 0),
  };
};

export async function undoLastMusicPlay() {
  const payload = state.lastMusicUndo;
  if (!payload) return false;
  const btn = state.scene.buttons.find((b) => b.id === payload.buttonId);
  if (!btn || btn.type !== "music") return false;
  state.lastMusicUndo = null;
  const options = { startAt: payload.time, skipUndo: true };
  if (payload.trackId) options.forceTrackId = payload.trackId;
  await playButton(payload.buttonId, "restart", options);
  return true;
}

export async function playButton(buttonId, clickBehavior, options = {}) {
  if (!ensureApi()) return;
  const btn = state.scene.buttons.find((b) => b.id === buttonId);
  if (!btn) {
    if (dom.propertiesError) dom.propertiesError.textContent = "Кнопка не выбрана.";
    return;
  }
  if (!btn.tracks || !btn.tracks.length) {
    if (dom.propertiesError) dom.propertiesError.textContent = "Нет треков. Добавьте трек.";
    return;
  }

  const requestedBehavior = clickBehavior || btn.onClickBehavior || "restart";
  const fadeInMs = Math.max(0, Number(btn.fadeIn) || 0);
  const fadeOutMs = Math.max(0, Number(btn.fadeOut) || 0);
  if (requestedBehavior === "open-playlist" && state.isPerformance) {
    const opened = openPlaylistPicker(buttonId);
    if (opened) return;
    return;
  }
  const behavior = requestedBehavior;
  const existing = state.players.get(buttonId);
  if (existing && existing.audio) {
    if (behavior === "pause") {
      if (existing.audio.paused) {
        existing.audio.play();
      } else {
        existing.audio.pause();
      }
      return;
    }
    const fadeLimit = fadeInMs;
    const forceStop = fadeLimit <= 0;
    if (behavior === "stop") {
      stopAudio(buttonId, {
        targetAudio: existing.audio,
        targetTrackId: existing.trackId,
        fadeLimit,
        force: forceStop,
      });
      return;
    }
    stopAudio(buttonId, {
      targetAudio: existing.audio,
      targetTrackId: existing.trackId,
      fadeLimit,
      force: forceStop,
    });
  }

  try {
    let fileUrl = "";
    let trackLabel = "";
    let selectedTrack = null;
    let selectedIndex = 0;
    if (btn.playMode === "playlist") {
      const { forceTrackId = null, forceTrackIndex } = options;
      let picked = null;
      if (forceTrackId) {
        const idx = btn.tracks.findIndex((t) => t.id === forceTrackId);
        if (idx !== -1) {
          picked = { index: idx, track: btn.tracks[idx] };
        }
      } else if (typeof forceTrackIndex === "number" && btn.tracks[forceTrackIndex]) {
        picked = { index: forceTrackIndex, track: btn.tracks[forceTrackIndex] };
      }
      if (!picked) {
        picked = pickPlaylistTrack(buttonId, btn);
      } else {
        const stateEntry = state.playlistState.get(buttonId) || { lastIndex: -1, history: [] };
        const gap = Math.max(0, btn.repeatGap || 0);
        const history = btn.playlistMode === "random" ? [...(stateEntry.history || []), picked.index] : stateEntry.history || [];
        const limitedHistory = btn.playlistMode === "random" ? history.slice(-(gap + 1)) : history;
        state.playlistState.set(buttonId, { ...stateEntry, lastIndex: picked.index, history: limitedHistory });
      }
      if (!picked || !picked.track?.file) {
        if (dom.propertiesError) dom.propertiesError.textContent = "Плейлист пуст или нет файлов.";
        return;
      }
      fileUrl = await resolveTrackUrl(btn, picked.track);
      trackLabel = baseName(picked.track.label || picked.track.file || "—");
      btn.file = picked.track.file;
      selectedTrack = picked.track;
      selectedIndex = picked.index ?? 0;
    } else {
      const first = btn.tracks[0];
      if (!first?.file) {
        if (dom.propertiesError) dom.propertiesError.textContent = "Нет треков. Добавьте трек.";
        return;
      }
      fileUrl = await resolveTrackUrl(btn, first);
      trackLabel = baseName(first.label || first.file || "—");
      btn.file = first.file;
      selectedTrack = first;
      selectedIndex = 0;
    }

    let playbackSegment = null;
    let reverseUrl = null;
    if (selectedTrack?.segment?.reverse) {
      const { url, segment, duration } = await getReversedSegmentUrl(selectedTrack, selectedTrack.segment);
      reverseUrl = url;
      playbackSegment = {
        start: 0,
        end: duration,
        loop: Boolean(segment.loop),
        reverse: true,
        originalStart: segment.start,
        originalEnd: segment.end,
      };
      fileUrl = url;
    }

    if (btn.markUsed && !btn.usedOnce) {
      btn.usedOnce = true;
      renderGrid();
      persistUsageFlags();
      if (btn.id === state.selectedButtonId) renderProperties();
    }

    if (btn.type === "music") {
    const crossFadeLimit = fadeInMs;
    const forceCut = crossFadeLimit <= 0;
    stopMusicPlayers(buttonId, {
      smooth: true,
      fadeLimit: crossFadeLimit,
      force: forceCut,
      skipUndo: options.skipUndo,
    });
    window.stagepadAPI?.notifyMusicPlay?.({ fadeLimit: crossFadeLimit });
  }

    const restartFadeLimit = fadeInMs;
    stopAudio(buttonId, { fadeLimit: restartFadeLimit, force: restartFadeLimit <= 0 });
    const audio = new Audio(fileUrl);
    audio.preload = "auto";
    await applyAudioOutput(audio, state.isPerformance);
    audio.volume = 1;
    const initialSegment = playbackSegment || resolveSegment(selectedTrack, 0);
    const requestedStartAt = Number.isFinite(options.startAt) ? Number(options.startAt) : null;
    const normalizedActive = Boolean(selectedTrack?.useNormalized && selectedTrack?.normalizedFile);
    const loudnessGainDb = normalizedActive
      ? 0
      : Number.isFinite(selectedTrack?.loudnessGainDb)
        ? Number(selectedTrack.loudnessGainDb)
        : 0;
    state.players.set(buttonId, {
      audio,
      type: btn.type,
      progress: 0,
      isPlaying: false,
      buttonLabel: btn.label,
      trackLabel,
      fadeLabel: `FI ${fadeInMs} / FO ${fadeOutMs}`,
      trackId: selectedTrack?.id,
      playMode: btn.playMode,
      segment: initialSegment,
      group: clampGroupIndex(btn.audioGroup),
      baseVolume: 1,
      loudnessGainDb,
      normalizedActive,
    });
    const createdEntry = state.players.get(buttonId);
    if (createdEntry) {
      createdEntry.group = clampGroupIndex(btn.audioGroup);
      createdEntry.baseVolume = 1;
      if (!createdEntry._normLogged) {
        createdEntry._normLogged = true;
        const loudnessGain = state.normalizationEnabled ? dbToGain(createdEntry.loudnessGainDb || 0) : 1;
        const groupGain = getGroupGain(createdEntry.group);
        const base = Number.isFinite(createdEntry.baseVolume) ? createdEntry.baseVolume : 1;
        console.info("[stagepad][loudness] play", {
          buttonId,
          trackId: createdEntry.trackId,
          gainDb: createdEntry.loudnessGainDb,
          enabled: state.normalizationEnabled,
          gainFactor: Number(loudnessGain.toFixed(4)),
          groupGain: Number(groupGain.toFixed(4)),
          finalVolume: Number(Math.max(0, Math.min(1, base * loudnessGain * groupGain)).toFixed(4)),
          fadeInMs,
          fadeOutMs,
        });
      }
      applyGroupVolume(createdEntry);
      attachEntryToGroupMeter(createdEntry);
    }

    audio.addEventListener("ended", () => {
      const entry = state.players.get(buttonId);
      const seg = entry?.segment || resolveSegment(selectedTrack, audio.duration || 0);
      if (seg?.loop && seg.end > seg.start) {
        if (DEBUG_LOOP) {
          console.warn("[stagepad][loop] ended->restart", {
            buttonId,
            trackId: entry?.trackId,
            currentTime: audio.currentTime,
            seg,
          });
        }
        audio.currentTime = seg.start;
        if (audio.paused) safePlay(audio, "ended-restart");
        return;
      }
      if (DEBUG_LOOP) {
        console.warn("[stagepad][loop] ended->stop", {
          buttonId,
          trackId: entry?.trackId,
          currentTime: audio.currentTime,
          seg,
          hasEntry: Boolean(entry),
        });
      }
      state.players.delete(buttonId);
      updateProgressVisual(buttonId, 0, false);
      renderPlayingStack();
      releaseAfterPlayback(selectedTrack?.id, btn);
    });
    audio.addEventListener("error", (event) => {
      if (!DEBUG_LOOP) return;
      console.warn("[stagepad][loop] audio error", {
        buttonId,
        trackId: state.players.get(buttonId)?.trackId,
        currentTime: audio.currentTime,
        code: audio.error?.code,
        message: audio.error?.message,
        event,
      });
    });
    audio.addEventListener("stalled", () => {
      if (!DEBUG_LOOP) return;
      console.warn("[stagepad][loop] stalled", {
        buttonId,
        trackId: state.players.get(buttonId)?.trackId,
        currentTime: audio.currentTime,
      });
    });
    audio.addEventListener("abort", () => {
      if (!DEBUG_LOOP) return;
      console.warn("[stagepad][loop] abort", {
        buttonId,
        trackId: state.players.get(buttonId)?.trackId,
        currentTime: audio.currentTime,
      });
    });
    audio.addEventListener("emptied", () => {
      if (!DEBUG_LOOP) return;
      console.warn("[stagepad][loop] emptied", {
        buttonId,
        trackId: state.players.get(buttonId)?.trackId,
        currentTime: audio.currentTime,
      });
    });
    audio.addEventListener("waiting", () => {
      if (!DEBUG_LOOP) return;
      console.warn("[stagepad][loop] waiting", {
        buttonId,
        trackId: state.players.get(buttonId)?.trackId,
        currentTime: audio.currentTime,
      });
    });
    const applyStartAt = (audioEl, seg) => {
      if (!Number.isFinite(requestedStartAt)) return;
      const lower = Math.max(0, seg?.start || 0);
      const upper = Number.isFinite(seg?.end) && seg.end > lower ? seg.end : audioEl.duration;
      const desired = Math.max(lower, Math.min(requestedStartAt, Number.isFinite(upper) ? upper : requestedStartAt));
      if (Number.isFinite(desired)) {
        audioEl.currentTime = desired;
      }
    };

    audio.addEventListener("loadedmetadata", () => {
      const seg = playbackSegment || resolveSegment(selectedTrack, audio.duration);
      const entry = state.players.get(buttonId);
      if (entry) entry.segment = seg;
      applyStartAt(audio, seg);
      if (seg?.loop) return;
      if (fadeOutMs > 0 && isFinite(audio.duration) && audio.duration > 0) {
        const effectiveEnd = seg.end && seg.end > seg.start ? seg.end : audio.duration;
        const startFade = Math.max(0, effectiveEnd * 1000 - fadeOutMs);
        setTimeout(() => {
          const entry = state.players.get(buttonId);
          if (entry?.audio) {
            const fromBase = Number.isFinite(entry.baseVolume) ? entry.baseVolume : entry.audio.volume;
            fadeEntryVolume(entry, fromBase, 0, fadeOutMs, () => entry.audio.pause());
          } else {
            fadeAudio(audio, audio.volume, 0, fadeOutMs, () => audio.pause());
          }
        }, startFade);
      }
    });
    audio.addEventListener("timeupdate", () => {
      const entry = state.players.get(buttonId);
      const seg = entry?.segment || resolveSegment(selectedTrack, audio.duration);
      const segLength = Math.max(0.001, (seg.end || audio.duration) - seg.start);
      const currentPos = seg.reverse ? audio.currentTime : Math.max(0, audio.currentTime - (seg.start || 0));
      const progress = Math.max(0, Math.min(1, currentPos / segLength));
      if (entry) {
        entry.progress = progress;
        entry.lastTime = audio.currentTime;
        entry.isPlaying = !audio.paused;
        if (state.currentWaveTrackId && selectedTrack?.id === state.currentWaveTrackId) {
          state.waveMarkerTime = seg.reverse
            ? (seg.originalEnd ?? seg.end ?? audio.duration) - audio.currentTime
            : audio.currentTime;
          drawWaveform(
            selectedTrack,
            state.waveBuffers.get(state.currentWaveTrackId)?.peaks || [],
            state.waveDuration || audio.duration
          );
        }
        if (seg.reverse) {
          if (audio.currentTime >= segLength - 0.05) {
            if (seg.loop) {
              if (DEBUG_LOOP) {
                console.warn("[stagepad][loop] reverse loop jump", {
                  buttonId,
                  trackId: entry?.trackId,
                  currentTime: audio.currentTime,
                  seg,
                  paused: audio.paused,
                });
              }
              audio.currentTime = 0;
              if (audio.paused) safePlay(audio, "reverse-loop-jump");
            } else {
              stopAudio(buttonId);
              return;
            }
          }
        } else if (seg.end > seg.start && audio.currentTime >= seg.end - 0.05) {
          if (seg.loop) {
            if (DEBUG_LOOP) {
              console.warn("[stagepad][loop] loop jump", {
                buttonId,
                trackId: entry?.trackId,
                currentTime: audio.currentTime,
                seg,
                paused: audio.paused,
              });
            }
            audio.currentTime = seg.start;
            if (audio.paused) safePlay(audio, "loop-jump");
          } else {
            stopAudio(buttonId);
            return;
          }
        }
      }
      updateProgressVisual(buttonId, progress, !audio.paused);
    });
    audio.addEventListener("play", () => {
      const entry = state.players.get(buttonId);
      if (entry?.segment && Number.isFinite(requestedStartAt)) {
        const epsilon = 0.12;
        if (Math.abs(audio.currentTime - requestedStartAt) > epsilon) {
          applyStartAt(audio, entry.segment);
        }
      }
      if (DEBUG_LOOP && entry?.segment?.loop) {
        console.warn("[stagepad][loop] play", {
          buttonId,
          trackId: entry?.trackId,
          currentTime: audio.currentTime,
          seg: entry?.segment,
        });
      }
      if (entry) entry.isPlaying = true;
      updateProgressVisual(buttonId, state.players.get(buttonId)?.progress || 0, true);
      renderPlayingStack();
      publishActiveGroups();
      if (entry) {
        attachEntryToGroupMeter(entry);
        if (!entry._meterSource && !entry._meterAttaching && entry._meterRetry == null) {
          entry._meterRetry = setTimeout(() => {
            attachEntryToGroupMeter(entry);
            entry._meterRetry = null;
          }, 300);
        }
      }
      if (state.isPerformance) {
        renderGrid();
      }
      if (btn.playMode === "playlist" && typeof selectedIndex === "number") {
        prefetchNextTrack(buttonId, btn, selectedIndex);
      }
    });
    audio.addEventListener("pause", () => {
      const entry = state.players.get(buttonId);
      if (DEBUG_LOOP && entry?.segment?.loop) {
        console.warn("[stagepad][loop] pause", {
          buttonId,
          trackId: entry?.trackId,
          currentTime: audio.currentTime,
          seg: entry?.segment,
        });
      }
      if (entry) entry.isPlaying = false;
      updateProgressVisual(buttonId, state.players.get(buttonId)?.progress || 0, false);
      renderPlayingStack();
      publishActiveGroups();
      if (state.isPerformance) {
        renderGrid();
      }
      if (state.currentWaveTrackId && selectedTrack?.id === state.currentWaveTrackId) {
        state.waveMarkerTime = audio.currentTime;
        drawWaveform(
          selectedTrack,
          state.waveBuffers.get(state.currentWaveTrackId)?.peaks || [],
          state.waveDuration || audio.duration
        );
      }
    });

    if (fadeInMs > 0) {
      const entry = state.players.get(buttonId);
      if (entry?.audio) {
        setEntryBaseVolume(entry, 0);
        safePlay(audio, "start-fadein").then(() => fadeEntryVolume(entry, 0, 1, fadeInMs));
      } else {
        audio.volume = 0;
        safePlay(audio, "start-fadein").then(() => fadeAudio(audio, 0, 1, fadeInMs));
      }
    } else {
      safePlay(audio, "start");
    }
    renderPlayingStack();
  } catch (error) {
    if (dom.propertiesError) dom.propertiesError.textContent = error?.message || "Не удалось воспроизвести файл";
  }
}

export async function addTrackFromFile(file) {
  // Legacy path (direct import). New flow handled via import modal.
  if (!ensureApi()) return;
  if (!file || !state.selectedButtonId) return;
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn) return;
  const targetDir = "audio";
  try {
    let relativePath = "";
    if (file.path) {
      relativePath = await window.stagepadAPI.importAsset(state.currentProject.id, file.path, targetDir);
    } else {
      const buf = await file.arrayBuffer();
      relativePath = await window.stagepadAPI.importAssetFromBuffer(
        state.currentProject.id,
        file.name,
        buf,
        targetDir
      );
    }
    const label = file.name || relativePath;
    const track = {
      id: `track_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file: relativePath,
      label,
      loudnessGainDb: 0,
      normalizedFile: "",
      useNormalized: false,
    };
    btn.tracks.push(track);
    selectButton(btn.id);
  } catch (error) {
    if (dom.propertiesError) dom.propertiesError.textContent = error?.message || "Не удалось добавить трек";
  }
}

export function reorderTracks(sourceId, targetId) {
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn || !btn.tracks) return;
  const sourceIndex = btn.tracks.findIndex((t) => t.id === sourceId);
  const targetIndex = btn.tracks.findIndex((t) => t.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;
  const [moved] = btn.tracks.splice(sourceIndex, 1);
  btn.tracks.splice(targetIndex, 0, moved);
  renderPlaylist();
  setSceneDirty(true);
}

export function deleteTrack(trackId) {
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn || !btn.tracks) return;
  stopTrackPreview(trackId);
  btn.tracks = btn.tracks.filter((t) => t.id !== trackId);
  if (!btn.tracks.length) {
    // Если треков не осталось, сбрасываем старое поле file, чтобы при следующей загрузке не восстановился.
    btn.file = "";
  }
  renderPlaylist();
  renderGrid();
  renderProperties();
  setSceneDirty(true);
}

export function deleteSelectedButton() {
  if (!state.selectedButtonId) {
    if (dom.propertiesError) dom.propertiesError.textContent = "Сначала выберите кнопку.";
    return;
  }
  stopAudio(state.selectedButtonId);
  state.scene.buttons = state.scene.buttons.filter((b) => b.id !== state.selectedButtonId);
  state.selectedButtonId = null;
  clampButtonsToGrid();
  renderGrid();
  renderProperties();
  setSceneDirty(true);
}

export function openGridModal() {
  if (!dom.gridModal) return;
  dom.gridColsInput.value = state.gridCols;
  dom.gridRowsInput.value = state.gridRows;
  dom.gridModal.hidden = false;
}

export function closeGridModal() {
  if (!dom.gridModal) return;
  dom.gridModal.hidden = true;
}

export function bindPlayingClick(el) {
  el?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-playing-id]");
    if (!item) return;
    const id = item.dataset.playingId;
    const clicks = event.detail || 1;
    if (clicks >= 3) {
      stopAudio(id);
    } else if (clicks === 2) {
      fadeOutAndStop(id, 2000);
    }
  });
}

window.addEventListener("beforeunload", () => {
  clearProjectGroups();
  localStorage.removeItem(ACTIVE_PERF_PROJECT_KEY);
});
