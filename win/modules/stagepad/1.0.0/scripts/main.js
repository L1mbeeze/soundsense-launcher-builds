import { ensureApi } from "./api.js";
import { dom } from "./dom.js";
import {
  applyGridCss,
  bindPlayingClick,
  clampButtonsToGrid,
  closeGridModal,
  deleteSelectedButton,
  deleteTrack,
  duplicateButton,
  fadeOutAndStop,
  handleAddButton,
  handleCreateAtSlot,
  loadScene,
  moveButton,
  openGridModal,
  playButton,
  renderGrid,
  renderPlayingStack,
  renderPlaylist,
  renderProperties,
  reorderTracks,
  togglePlaylistPreview,
  togglePlaylistExpanded,
  refreshGroupVolumes,
  saveScene,
  selectButton,
  getButtonAt,
  findFirstFreeSlot,
  ensureButtonContentFits,
  setSceneDirty,
  stopAllAudio,
  stopAudio,
  stopMusicPlayers,
  resetUsageFlags,
  persistUsageFlags,
  togglePreload,
  clearPreloadCache,
  updateButtonField,
  updateFadeLabels,
  updateLayoutMode,
  updateListToggleVisibility,
  undoLastMusicPlay,
  importButtonFromProject,
  sortButtonsByName,
  closePlaylistPicker,
  clearProjectGroups,
} from "./editor.js";
import {
  closeDeleteModal,
  closeEditorModal,
  ensureModalsHidden,
  loadProjects,
  openDeleteModal,
  openEditorModal,
  openInstructionModal,
  closeInstructionModal,
  applyDescriptionLimit,
  handleDescriptionInput,
  normalizeProjectGroup,
  renderProjects,
} from "./projects.js";
import { DEFAULT_COLS, DEFAULT_ROWS, startupPerformance, startupProjectId, state } from "./state.js";
import {
  closeWavePopover,
  continueWaveInteraction,
  drawWaveform,
  findTrackById,
  playWavePreview,
  resolveSegment,
  setStartMarker,
  showWaveform,
  startWaveInteraction,
  stopWaveInteraction,
  stopWavePreview,
  timeFromClientX,
  updateTrackSegment,
} from "./waveform.js";
import { openImportModal } from "./import-modal.js";
import {
  applyAlwaysOnTopSetting,
  normalizeClickAction,
  persistClickActions,
  persistPerfFontSize,
  refreshPerfFontSize,
  updateAlwaysOnTopUI,
  updateClickActionsUI,
  updatePerfDefaultViewUI,
  updatePreloadToggleUI,
} from "./performance-helpers.js";
import { tooltipText } from "./tooltips.js";

let appPage = "combined";
let bootstrapPromise = null;
let windowControlsBound = false;
const SETTINGS_WINDOW_OPTS = "width=960,height=720,noopener,noreferrer";
const MIXER_WINDOW_OPTS = "width=760,height=520,noopener,noreferrer";
let coverFile = null;
let coverPreviewUrl = "";
let coverExistingPath = "";
let coverConfig = { fit: "cover", position: "center" };
let coverSourceUrl = "";
let coverPreparedBlob = null;
let coverPreparedName = "";
let cropImage = null;
let cropScale = 1;
let cropBaseScale = 1;
let cropOffset = { x: 0, y: 0 };
let cropDragging = false;
let cropLastPos = { x: 0, y: 0 };
const COVER_TARGET = { width: 360, height: 200 };
let coverWindowActive = false;
const COVER_STATE_KEY = "stagepadCoverState";
const ACTIVE_PERF_PROJECT_KEY = "stagepadActivePerformanceProject";
const REMOTE_STATE_INTERVAL = 250;
let remoteStateTimer = null;
const MIXER_NAMES_KEY = "stagepadMixerGroupNames";
const MIXER_MIN_DB = -60;
const MIXER_MAX_DB = 0;

const parseHotkey = (value) => {
  if (!value) return null;
  const parts = String(value)
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return null;
  const hotkey = { ctrl: false, alt: false, shift: false, key: "" };
  parts.forEach((part) => {
    if (part === "ctrl" || part === "control") hotkey.ctrl = true;
    else if (part === "alt") hotkey.alt = true;
    else if (part === "shift") hotkey.shift = true;
    else hotkey.key = part;
  });
  if (!hotkey.key) return null;
  if (hotkey.key === "space") hotkey.key = " ";
  return hotkey;
};

const matchesHotkey = (event, hotkey) => {
  if (!hotkey) return false;
  if (Boolean(event.ctrlKey) !== Boolean(hotkey.ctrl)) return false;
  if (Boolean(event.altKey) !== Boolean(hotkey.alt)) return false;
  if (Boolean(event.shiftKey) !== Boolean(hotkey.shift)) return false;
  const key = (event.key || "").toLowerCase();
  return key === hotkey.key || (hotkey.key === " " && key === " ");
};

const openSettingsWindow = () => {
  window.open("settings.html", "stagepad-settings", SETTINGS_WINDOW_OPTS);
};
const openMixerWindow = () => {
  if (window.stagepadAPI?.openMixer) {
    window.stagepadAPI.openMixer();
    return;
  }
  window.open("mixer.html", "stagepad-mixer", MIXER_WINDOW_OPTS);
};

const applyMixerGroupNames = () => {
  if (!dom.inputAudioGroup) return;
  let names = [];
  try {
    const raw = localStorage.getItem("stagepadMixerGroupNames");
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === 12) names = parsed;
  } catch (_) {
    /* ignore */
  }
  if (!names.length) {
    names = Array.from({ length: 12 }, (_, idx) => (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`));
  }
  const options = dom.inputAudioGroup.querySelectorAll("option");
  options.forEach((opt, idx) => {
    const title = names[idx] || (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`);
    opt.textContent = title;
  });
};

const openEscapeModal = () => {
  if (dom.escapeModal) dom.escapeModal.hidden = false;
};

const closeEscapeModal = () => {
  if (dom.escapeModal) dom.escapeModal.hidden = true;
};

const toggleEscapeModal = () => {
  if (!dom.escapeModal) return;
  const isOpen = !dom.escapeModal.hidden;
  if (isOpen) {
    closeEscapeModal();
  } else {
    openEscapeModal();
  }
};

function updateCoverToggleUI() {
  const legacyText = coverWindowActive ? "Выключить обложку" : "Включить обложку";
  const perfText = coverWindowActive ? "Скрыть обложку" : "Показать обложку";
  if (dom.escapeCoverToggle) {
    dom.escapeCoverToggle.disabled = !state.isPerformance;
    dom.escapeCoverToggle.textContent = legacyText;
  }
  if (dom.perfCoverToggle) {
    dom.perfCoverToggle.disabled = !state.isPerformance;
    dom.perfCoverToggle.textContent = perfText;
  }
}

function setCoverState(open, projectId = null) {
  coverWindowActive = Boolean(open);
  const payload = { open: coverWindowActive, projectId: projectId || null, updatedAt: Date.now() };
  localStorage.setItem(COVER_STATE_KEY, JSON.stringify(payload));
  updateCoverToggleUI();
}

const coverPositionMap = {
  center: "center",
  top: "center top",
  bottom: "center bottom",
  left: "left center",
  right: "right center",
};

const applyCoverStyle = (el) => {
  if (!el) return;
  const size = coverConfig.fit === "fill" ? "100% 100%" : coverConfig.fit || "cover";
  el.style.backgroundSize = size;
  el.style.backgroundPosition = coverPositionMap[coverConfig.position] || "center";
};

const setThumbPreview = (url) => {
  if (!dom.projectImageThumb) return;
  if (url) {
    dom.projectImageThumb.style.backgroundImage = `url(${url})`;
    dom.projectImageThumb.dataset.hasImage = "true";
  } else {
    dom.projectImageThumb.style.backgroundImage = "";
    dom.projectImageThumb.dataset.hasImage = "false";
  }
  applyCoverStyle(dom.projectImageThumb);
};

const setConfigPreview = (url) => {
  if (!dom.imageConfigPreview) return;
  if (url) {
    dom.imageConfigPreview.style.backgroundImage = `url(${url})`;
    dom.imageConfigPreview.dataset.hasImage = "true";
  } else {
    dom.imageConfigPreview.style.backgroundImage = "";
    dom.imageConfigPreview.dataset.hasImage = "false";
  }
  applyCoverStyle(dom.imageConfigPreview);
};

const resetCoverSelection = () => {
  closeImageConfigModal();
  coverFile = null;
  coverPreparedBlob = null;
  coverPreparedName = "";
  coverPreviewUrl = "";
  coverExistingPath = "";
  coverConfig = { fit: "cover", position: "center" };
  coverSourceUrl = "";
  cropImage = null;
  if (dom.projectImageInput) dom.projectImageInput.value = "";
  setThumbPreview("");
  setConfigPreview("");
  dom.projectImageConfigure?.setAttribute("disabled", "true");
  dom.projectImageReset?.setAttribute("disabled", "true");
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function clampOffset() {
  if (!cropImage || !dom.imageCropViewport) return;
  const rect = dom.imageCropViewport.getBoundingClientRect();
  const vw = rect.width || COVER_TARGET.width;
  const vh = rect.height || COVER_TARGET.height;
  const imgW = cropImage.naturalWidth * cropScale;
  const imgH = cropImage.naturalHeight * cropScale;
  const maxX = Math.max((imgW - vw) / 2, 0);
  const maxY = Math.max((imgH - vh) / 2, 0);
  cropOffset.x = Math.min(maxX, Math.max(-maxX, cropOffset.x));
  cropOffset.y = Math.min(maxY, Math.max(-maxY, cropOffset.y));
}

function renderCrop() {
  if (!dom.imageCropSource || !cropImage) return;
  dom.imageCropSource.style.transform = `translate(-50%, -50%) translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropScale})`;
  updateCropPreview();
}

function updateCropPreview() {
  if (!cropImage || !dom.imageCropViewport || !dom.imageCropPreview) return;
  const ctx = dom.imageCropPreview.getContext("2d");
  if (!ctx) return;
  const targetW = dom.imageCropPreview.width;
  const targetH = dom.imageCropPreview.height;
  ctx.fillStyle = "#0f141d";
  ctx.fillRect(0, 0, targetW, targetH);

  const rect = dom.imageCropViewport.getBoundingClientRect();
  const vw = rect.width || COVER_TARGET.width;
  const vh = rect.height || COVER_TARGET.height;
  const s = cropScale;
  const imgW = cropImage.naturalWidth;
  const imgH = cropImage.naturalHeight;

  const imgX0 = (-vw / 2 - cropOffset.x) / s + imgW / 2;
  const imgY0 = (-vh / 2 - cropOffset.y) / s + imgH / 2;
  const cropW = vw / s;
  const cropH = vh / s;

  ctx.drawImage(cropImage, imgX0, imgY0, cropW, cropH, 0, 0, targetW, targetH);
}

function setZoom(value) {
  const zoom = Math.max(1, Math.min(4, value));
  cropScale = cropBaseScale * zoom;
  if (dom.imageCropZoom) dom.imageCropZoom.value = zoom.toString();
  clampOffset();
  renderCrop();
}

function initCropper() {
  if (!coverSourceUrl || !dom.imageCropSource || !dom.imageCropViewport) return;
  cropDragging = false;
  cropOffset = { x: 0, y: 0 };
  cropScale = 1;
  cropBaseScale = 1;
  const img = new Image();
  img.onload = () => {
    cropImage = img;
    dom.imageCropSource.src = img.src;
    const rect = dom.imageCropViewport.getBoundingClientRect();
    const vw = rect.width || COVER_TARGET.width;
    const vh = rect.height || COVER_TARGET.height;
    cropBaseScale = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
    setZoom(1);
    renderCrop();
  };
  img.src = coverSourceUrl;
}

function ensureCropImageLoaded() {
  if (cropImage) return Promise.resolve(true);
  if (!coverSourceUrl) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      cropImage = img;
      const rect = dom.imageCropViewport?.getBoundingClientRect?.();
      const vw = rect?.width || COVER_TARGET.width;
      const vh = rect?.height || COVER_TARGET.height;
      cropBaseScale = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
      cropScale = cropBaseScale;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = coverSourceUrl;
  });
}

function onCropPointerDown(event) {
  if (!cropImage) return;
  cropDragging = true;
  cropLastPos = { x: event.clientX, y: event.clientY };
}

function onCropPointerMove(event) {
  if (!cropDragging) return;
  const dx = event.clientX - cropLastPos.x;
  const dy = event.clientY - cropLastPos.y;
  cropLastPos = { x: event.clientX, y: event.clientY };
  cropOffset.x += dx;
  cropOffset.y += dy;
  clampOffset();
  renderCrop();
}

function onCropPointerUp() {
  cropDragging = false;
}

function onCropWheel(event) {
  if (!dom.imageCropViewport) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 0.1 : -0.1;
  const currentZoom = Number(dom.imageCropZoom?.value || 1);
  setZoom(currentZoom + delta);
}

async function exportCroppedCover() {
  if (!cropImage) {
    const loaded = await ensureCropImageLoaded();
    if (!loaded) return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = COVER_TARGET.width;
  canvas.height = COVER_TARGET.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const rect = dom.imageCropViewport?.getBoundingClientRect
    ? dom.imageCropViewport.getBoundingClientRect()
    : { width: COVER_TARGET.width, height: COVER_TARGET.height };
  const vw = rect.width || COVER_TARGET.width;
  const vh = rect.height || COVER_TARGET.height;
  const s = cropScale;
  const imgW = cropImage.naturalWidth;
  const imgH = cropImage.naturalHeight;
  const imgX0 = (-vw / 2 - cropOffset.x) / s + imgW / 2;
  const imgY0 = (-vh / 2 - cropOffset.y) / s + imgH / 2;
  const cropW = vw / s;
  const cropH = vh / s;

  ctx.drawImage(cropImage, imgX0, imgY0, cropW, cropH, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) resolve(null);
      else resolve(blob);
    }, "image/jpeg", 0.9);
  });
}

async function handleCoverInputChange(event) {
  const file = event?.target?.files?.[0];
  if (!file) {
    resetCoverSelection();
    return;
  }
  coverFile = file;
  coverExistingPath = "";
  coverSourceUrl = "";
  coverPreparedBlob = null;
  coverPreparedName = "";
  try {
    coverPreviewUrl = await readFileAsDataUrl(file);
    coverSourceUrl = coverPreviewUrl;
    setThumbPreview(coverPreviewUrl);
    dom.projectImageConfigure?.removeAttribute("disabled");
    dom.projectImageReset?.removeAttribute("disabled");
  } catch (error) {
    console.error("Не удалось прочитать файл изображения:", error);
    resetCoverSelection();
  }
}

function openImageConfigModal() {
  if (!coverPreviewUrl && !coverExistingPath && !coverSourceUrl) return;
  if (dom.imageCropModal) dom.imageCropModal.hidden = false;
  requestAnimationFrame(initCropper);
}

function closeImageConfigModal() {
  if (dom.imageCropModal) dom.imageCropModal.hidden = true;
  cropDragging = false;
}

function applyCoverConfigFromControls() {
  // no-op placeholder for backward compatibility
}

function populateCoverFromProject(project) {
  resetCoverSelection();
  if (!project) return;
  coverConfig = {
    fit: project.coverFit || "cover",
    position: project.coverPosition || "center",
  };
  if (project.coverImage && ensureApi()) {
    try {
      const url = window.stagepadAPI.getAssetFileUrl(project.id, project.coverImage);
      coverExistingPath = project.coverImage;
      coverPreviewUrl = url;
      coverSourceUrl = url;
      setThumbPreview(url);
      dom.projectImageConfigure?.removeAttribute("disabled");
      dom.projectImageReset?.removeAttribute("disabled");
    } catch (error) {
      console.error("Не удалось загрузить обложку проекта:", error);
    }
  }
}

function bindWindowControls() {
  if (windowControlsBound) return;
  windowControlsBound = true;
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-window-action]");
    if (!btn) return;
    const action = btn.dataset.windowAction;
    const controls = window.stagepadAPI?.windowControls || window.stagepadWindow?.windowControls;
    if (!controls || !action) return;
    if (action === "minimize") controls.minimize?.();
    else if (action === "toggle-maximize") controls.toggleMaximize?.();
    else if (action === "close") controls.close?.();
  });
}

function switchView(view) {
  if (view === "editor") {
    dom.projectsView?.setAttribute("hidden", "true");
    dom.editorView?.removeAttribute("hidden");
    document.body.classList.toggle("performance-mode", state.isPerformance);
    if (state.isPerformance) {
      state.perfListMode = state.perfDefaultListMode;
      renderGrid();
    }
    updateLayoutMode();
    if (dom.panelSettings) dom.panelSettings.toggleAttribute("hidden", state.isPerformance);
    if (dom.panelStatus) dom.panelStatus.toggleAttribute("hidden", true);
    if (dom.perfFontSizeInput) dom.perfFontSizeInput.value = state.perfFontSize;
    if (dom.perfFontValue) dom.perfFontValue.textContent = `${state.perfFontSize} px`;
    if (dom.editorBadge)
      dom.editorBadge.textContent = state.isPerformance && state.currentProject ? state.currentProject.name : "Редактор";
    if (dom.editorTitle) dom.editorTitle.toggleAttribute("hidden", state.isPerformance);
    if (dom.editorSubtitle) dom.editorSubtitle.toggleAttribute("hidden", state.isPerformance);
    applyGridCss();
    updateListToggleVisibility();
    renderPlayingStack();
    updatePreloadToggleUI();
    updatePerfDefaultViewUI();
    updateClickActionsUI();
    applyAlwaysOnTopSetting(state.perfAlwaysOnTop, { persist: false });
  } else {
    dom.editorView?.setAttribute("hidden", "true");
    dom.projectsView?.removeAttribute("hidden");
    loadProjects(() => tryStartupPerformance());
    state.isPerformance = false;
    clearPreloadCache();
    document.body.classList.remove("performance-mode");
    document.body.classList.remove("narrow-perf");
    state.perfListMode = false;
    updateListToggleVisibility();
    updatePreloadToggleUI();
  }
}

async function tryStartupPerformance(forcedProjectId = null, force = false) {
  const targetId = forcedProjectId || startupProjectId;
  const shouldStart = force || startupPerformance;
  if (state.startupHandled || !targetId || !shouldStart) return false;
  let project = state.projects.find((p) => p.id === targetId);
  if (!project && ensureApi()) {
    try {
      project = await window.stagepadAPI.getProjectMeta?.(targetId);
    } catch (error) {
      console.error("Не удалось загрузить метаданные проекта для автозапуска:", error);
    }
  }
  if (!project) {
    // Фолбэк: запускаем без метаданных, чтобы не зависеть от списка
    project = { id: targetId, name: targetId, description: "" };
  }
  state.startupHandled = true;
  state.isPerformance = true;
  try {
    await loadScene(project);
  } catch (error) {
    console.error("Ошибка загрузки проекта в перфоманс-режиме:", error);
  }
  switchView("editor");
  return true;
}

async function tryStartupEditor(forcedProjectId = null, force = false) {
  const targetId = forcedProjectId || startupProjectId;
  if (state.startupHandled || !targetId) return false;
  if (!force && startupPerformance) return false;
  let project = state.projects.find((p) => p.id === targetId);
  if (!project && ensureApi()) {
    try {
      project = await window.stagepadAPI.getProjectMeta?.(targetId);
    } catch (error) {
      console.error("Не удалось загрузить метаданные проекта для автозагрузки редактора:", error);
    }
  }
  if (!project) return false;
  state.startupHandled = true;
  state.isPerformance = false;
  try {
    await loadScene(project);
  } catch (error) {
    console.error("Ошибка загрузки проекта в редакторе:", error);
  }
  switchView("editor");
  return true;
}

function handleCardAction(actionBtn) {
  const action = actionBtn.dataset.action;
  const id = actionBtn.dataset.id;
  if (!action || !id) return;
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;

  if (action === "launch") {
    window.stagepadAPI?.launchPerformance?.(project.id);
  } else if (action === "edit") {
    if (appPage === "projects") {
      const params = new URLSearchParams();
      params.set("project", project.id);
      params.set("mode", "editor");
      window.location.href = `editor.html?${params.toString()}`;
      return;
    }
    (async () => {
      state.isPerformance = false;
      await loadScene(project);
      switchView("editor");
    })();
  } else if (action === "rename") {
    resetCoverSelection();
    openEditorModal(project);
    populateCoverFromProject(project);
  } else if (action === "delete") {
    openDeleteModal(project);
  } else if (action === "instruction") {
    openInstructionModal(project);
  } else if (action === "logo") {
    const params = new URLSearchParams();
    params.set("project", project.id);
    window.location.href = `logo_editor.html?${params.toString()}`;
  }
}

function openCardMenu(card) {
  if (!card) return;
  const menu = card.querySelector(".card__menu-list");
  if (!menu) return;
  document.querySelectorAll(".card__menu-list").forEach((list) => {
    if (list !== menu) list.hidden = true;
  });
  document.querySelectorAll(".card").forEach((el) => el.classList.remove("is-menu-open"));
  menu.hidden = false;
  card.classList.add("is-menu-open");
}

function launchProjectById(id) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  window.stagepadAPI?.launchPerformance?.(project.id);
}

function exitProjectEditMode() {
  state.editingId = null;
  resetCoverSelection();
  closeEditorModal();
}

function showLeaveConfirm() {
  if (dom.leaveConfirmModal) dom.leaveConfirmModal.hidden = false;
}

function hideLeaveConfirm() {
  if (dom.leaveConfirmModal) dom.leaveConfirmModal.hidden = true;
}

function exitEditorToProjects() {
  if (appPage !== "combined") {
    window.location.href = "projects.html";
    return;
  }
  switchView("projects");
  clearProjectGroups();
  state.currentProject = null;
  state.selectedButtonId = null;
  state.scene = { buttons: [] };
  state.gridRows = DEFAULT_ROWS;
  state.gridCols = DEFAULT_COLS;
  applyGridCss();
}

function setCleanupNotice(message, type = "info") {
  if (!dom.cleanupNotice) return;
  dom.cleanupNotice.textContent = message || "";
  dom.cleanupNotice.classList.remove("modal__notice--success", "modal__notice--error");
  if (type === "success") {
    dom.cleanupNotice.classList.add("modal__notice--success");
  } else if (type === "error") {
    dom.cleanupNotice.classList.add("modal__notice--error");
  }
}

async function cleanupUnusedFiles() {
  if (!ensureApi() || !state.currentProject) return;
  setCleanupNotice("");
  const used = new Set();
  const normalizeUsedPath = (value) => {
    if (!value) return "";
    return String(value).replace(/\\/g, "/").replace(/^\.?\//, "");
  };
  (state.scene.buttons || []).forEach((btn) => {
    if (btn.file) used.add(normalizeUsedPath(btn.file));
    (btn.tracks || []).forEach((track) => {
      if (track.file) used.add(normalizeUsedPath(track.file));
      if (track.useNormalized && track.normalizedFile) {
        used.add(normalizeUsedPath(track.normalizedFile));
      }
    });
  });
  Array.from(used).forEach((path) => {
    if (path) used.add(path.toLowerCase());
  });
  try {
    const unused = await window.stagepadAPI.findUnusedAudio(state.currentProject.id, Array.from(used));
    if (!unused.length) {
      setCleanupNotice("Неиспользованных аудиофайлов не найдено.", "success");
      return;
    }
    setCleanupNotice(`Найдено неиспользованных файлов: ${unused.length}. Удаляю...`, "info");
    const removed = await window.stagepadAPI.deleteProjectFiles(state.currentProject.id, unused);
    setCleanupNotice(`Удалено файлов: ${removed.length}`, "success");
  } catch (error) {
    setCleanupNotice(error?.message || "Не удалось удалить неиспользованные файлы", "error");
  }
}

function getSelectedButtonData() {
  const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
  if (!btn) return null;
  return JSON.parse(JSON.stringify(btn));
}

function openTemplateSaveModal() {
  const btn = getSelectedButtonData();
  if (!btn) {
    if (dom.propertiesError) dom.propertiesError.textContent = "Сначала выберите кнопку.";
    return;
  }
  if (dom.templateNameInput) dom.templateNameInput.value = btn.label || "Шаблон";
  if (dom.templateSaveError) dom.templateSaveError.textContent = "";
  if (dom.templateSaveModal) dom.templateSaveModal.hidden = false;
  dom.templateNameInput?.focus();
}

function closeTemplateSaveModal() {
  if (dom.templateSaveModal) dom.templateSaveModal.hidden = true;
  if (dom.templateSaveError) dom.templateSaveError.textContent = "";
}

async function saveTemplateFromModal() {
  if (!ensureApi() || !state.currentProject) return;
  const btn = getSelectedButtonData();
  if (!btn) {
    if (dom.templateSaveError) dom.templateSaveError.textContent = "Нет выбранной кнопки.";
    return;
  }
  const name = dom.templateNameInput?.value?.trim();
  if (!name) {
    if (dom.templateSaveError) dom.templateSaveError.textContent = "Введите название шаблона.";
    return;
  }
  try {
    await window.stagepadAPI.saveTemplate(state.currentProject.id, name, btn);
    closeTemplateSaveModal();
  } catch (error) {
    if (dom.templateSaveError) dom.templateSaveError.textContent = error?.message || "Не удалось сохранить шаблон";
  }
}

let templateSelectionId = null;

function renderTemplateListUi(list = []) {
  if (!dom.templateList) return;
  dom.templateList.innerHTML = list
    .map(
      (tpl) => `
        <div class="template-card ${tpl.id === templateSelectionId ? "selected" : ""}" data-template-id="${tpl.id}">
          <div class="template-card__name">${tpl.name || tpl.id}</div>
          <div class="template-card__meta">${tpl.hasTracks || 0} треков</div>
        </div>
      `
    )
    .join("");
}

async function openTemplateListModal() {
  if (!ensureApi()) return;
  try {
    const list = await window.stagepadAPI.listTemplates();
    templateSelectionId = null;
    renderTemplateListUi(list);
    if (dom.templateApply) {
      dom.templateApply.disabled = true; // всегда отключаем до явного выбора
      dom.templateApply.hidden = list.length === 0;
    }
    if (dom.templateListError) dom.templateListError.textContent = list.length ? "" : "Шаблонов пока нет.";
    if (dom.templateListModal) dom.templateListModal.hidden = false;
  } catch (error) {
    if (dom.templateListError) dom.templateListError.textContent = error?.message || "Не удалось загрузить шаблоны";
    if (dom.templateListModal) dom.templateListModal.hidden = false;
  }
}

function closeTemplateListModal() {
  templateSelectionId = null;
  if (dom.templateApply) dom.templateApply.disabled = true;
  if (dom.templateListModal) dom.templateListModal.hidden = true;
}

async function applyTemplateToProject() {
  if (!ensureApi() || !state.currentProject || !templateSelectionId) return;
  const free = findFirstFreeSlot();
  if (!free) {
    if (dom.templateListError) dom.templateListError.textContent = "Нет свободного слота в сетке.";
    return;
  }
  try {
    const btn = await window.stagepadAPI.applyTemplate(state.currentProject.id, templateSelectionId);
    btn.position = btn.position ?? (free ? free.row * state.gridCols + free.col : 0);
    state.scene.buttons.push(btn);
    selectButton(btn.id);
    renderGrid();
    renderProperties();
    closeTemplateListModal();
  } catch (error) {
    if (dom.templateListError) dom.templateListError.textContent = error?.message || "Не удалось применить шаблон";
  }
}

  async function handleProjectSave() {
    if (!ensureApi()) return;
    const name = dom.inputName?.value;
    const description = applyDescriptionLimit(dom.inputDesc?.value || "");
    const group = normalizeProjectGroup(dom.inputGroup?.value);
    const instruction = dom.inputInstruction?.value || "";
    try {
      let project = null;
      const payload = { name, description, group, instruction, coverFit: "cover", coverPosition: "center", coverImage: coverExistingPath };
      if (state.editingId) {
        project = await window.stagepadAPI.updateProject(state.editingId, payload);
      } else {
        project = await window.stagepadAPI.createProject(payload);
      }
      if (!project && state.editingId) {
        const fallback = state.projects.find((p) => p.id === state.editingId);
        project = fallback || null;
      }
      if (project?.id && (coverPreparedBlob || coverFile || coverSourceUrl)) {
        const blob = coverPreparedBlob || (await exportCroppedCover());
        if (blob) {
          const buffer = await blob.arrayBuffer();
          project = await window.stagepadAPI.saveProjectCover(
            project.id,
            coverPreparedName || (coverFile ? coverFile.name : "cover.jpg"),
            buffer,
            { fit: "cover", position: "center" }
          );
        }
      }
      // Закрываем модалку проекта (сбрасывает editingId и чистит поля)
      closeEditorModal();
      resetCoverSelection();
      await loadProjects(() => tryStartupPerformance());
    } catch (error) {
      if (dom.modalError) dom.modalError.textContent = error?.message || "Ошибка сохранения";
    }
  }

  function bindProjectActions() {
    dom.btnCreate?.addEventListener("click", () => {
      resetCoverSelection();
      openEditorModal();
    });
  dom.selectGroup?.addEventListener("change", () => {
    if (dom.inputGroup) dom.inputGroup.value = dom.selectGroup.value;
  });
  dom.inputGroup?.addEventListener("input", () => {
    if (!dom.selectGroup) return;
    const typed = normalizeProjectGroup(dom.inputGroup.value);
    const match = Array.from(dom.selectGroup.options || []).find(
      (option) => normalizeProjectGroup(option.value).toLocaleLowerCase() === typed.toLocaleLowerCase()
    );
    dom.selectGroup.value = match ? match.value : "";
  });
    dom.inputDesc?.addEventListener("input", handleDescriptionInput);
    dom.projectImageInput?.addEventListener("change", handleCoverInputChange);
    dom.projectImageConfigure?.addEventListener("click", (event) => {
      event.preventDefault();
      openImageConfigModal();
    });
    dom.projectImageReset?.addEventListener("click", () => resetCoverSelection());
    dom.imageCropCancel?.addEventListener("click", () => closeImageConfigModal());
    dom.imageCropReset?.addEventListener("click", () => {
      if (!cropImage) return;
      cropOffset = { x: 0, y: 0 };
      setZoom(1);
    });
    dom.imageCropZoom?.addEventListener("input", () => setZoom(Number(dom.imageCropZoom.value || 1)));
    dom.imageCropZoomIn?.addEventListener("click", () => setZoom(Number(dom.imageCropZoom.value || 1) + 0.1));
    dom.imageCropZoomOut?.addEventListener("click", () => setZoom(Number(dom.imageCropZoom.value || 1) - 0.1));
    dom.imageCropApply?.addEventListener("click", async () => {
      const blob = await exportCroppedCover();
      if (blob) {
        coverPreparedBlob = blob;
        coverPreparedName = coverFile ? coverFile.name : "cover.jpg";
        const url = URL.createObjectURL(blob);
        coverPreviewUrl = url;
        coverSourceUrl = url;
        setThumbPreview(url);
      }
      closeImageConfigModal();
    });
    dom.imageCropViewport?.addEventListener("pointerdown", onCropPointerDown);
    window.addEventListener("pointermove", onCropPointerMove);
    window.addEventListener("pointerup", onCropPointerUp);
    dom.imageCropViewport?.addEventListener("wheel", onCropWheel, { passive: false });
  dom.projectGroupFilter?.addEventListener("change", () => {
    state.projectGroupFilter = normalizeProjectGroup(dom.projectGroupFilter.value);
    dom.projectGroupFilter.value = state.projectGroupFilter;
    renderProjects();
  });
  dom.projectSearch?.addEventListener("input", () => {
    state.projectSearchQuery = dom.projectSearch.value;
    renderProjects();
  });
  dom.instructionClose?.addEventListener("click", closeInstructionModal);
  dom.instructionModal?.addEventListener("click", (event) => {
    if (event.target === dom.instructionModal) {
      closeInstructionModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (appPage !== "projects") return;
    if (!dom.modalEditor?.hidden) {
      exitProjectEditMode();
    } else if (!dom.instructionModal?.hidden) {
      closeInstructionModal();
    } else {
      toggleEscapeModal();
    }
  });
  dom.btnSave?.addEventListener("click", async () => {
    await handleProjectSave();
  });
  dom.btnCancel?.addEventListener("click", exitProjectEditMode);
  dom.btnDeleteConfirm?.addEventListener("click", async () => {
    if (!ensureApi() || !state.deletingId) return;
    try {
      await window.stagepadAPI.deleteProject(state.deletingId);
      closeDeleteModal();
      await loadProjects(() => tryStartupPerformance());
    } catch (error) {
      alert(error?.message || "Не удалось удалить проект");
    }
  });
  dom.btnDeleteCancel?.addEventListener("click", closeDeleteModal);

  dom.escapeSettingsBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeEscapeModal();
    openSettingsWindow();
  });
  dom.escapeMixerBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeEscapeModal();
    openMixerWindow();
  });
  dom.escapeCloseBtn?.addEventListener("click", closeEscapeModal);
  const handleCoverToggle = async () => {
    if (!state.isPerformance) return;
    if (!ensureApi()) return;
    try {
      if (coverWindowActive) {
        await window.stagepadAPI.closeCover();
        setCoverState(false, null);
      } else {
        const projectId =
          state.currentProject?.id || localStorage.getItem(ACTIVE_PERF_PROJECT_KEY) || null;
        await window.stagepadAPI.openCover(projectId);
        setCoverState(true, projectId);
      }
    } catch (error) {
      console.error("Не удалось переключить обложку:", error);
    }
  };
  dom.escapeCoverToggle?.addEventListener("click", handleCoverToggle);
  dom.perfCoverToggle?.addEventListener("click", async () => {
    if (dom.perfFontModal) dom.perfFontModal.hidden = true;
    await handleCoverToggle();
  });
  dom.escapeModal?.addEventListener("click", (event) => {
    if (event.target === dom.escapeModal) closeEscapeModal();
  });
  dom.modalDelete?.addEventListener("click", (event) => {
    if (event.target === dom.modalDelete) closeDeleteModal();
  });
  dom.projectsList?.addEventListener("click", (event) => {
    const menuToggle = event.target.closest("[data-menu-toggle]");
    if (menuToggle) {
      event.stopPropagation();
      const card = menuToggle.closest(".card");
      const menu = menuToggle.nextElementSibling;
      if (menu && !menu.hidden) {
        menu.hidden = true;
        card?.classList.remove("is-menu-open");
      } else {
        openCardMenu(card);
      }
      return;
    }
    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn) {
      handleCardAction(actionBtn);
      if (!actionBtn.closest(".card__menu-list")) {
        document.querySelectorAll(".card__menu-list").forEach((list) => (list.hidden = true));
        document.querySelectorAll(".card").forEach((el) => el.classList.remove("is-menu-open"));
      }
    }
  });
  dom.projectsList?.addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    event.preventDefault();
    openCardMenu(card);
  });
  dom.projectsList?.addEventListener("dblclick", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    if (event.target.closest(".card__menu")) return;
    if (event.target.closest("[data-menu-toggle]")) return;
    if (event.target.closest("[data-action]")) return;
    if (event.target.closest("button")) return;
    const id = card.dataset.id;
    if (!id) return;
    launchProjectById(id);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".card__menu")) return;
    document.querySelectorAll(".card__menu-list").forEach((list) => (list.hidden = true));
    document.querySelectorAll(".card").forEach((el) => el.classList.remove("is-menu-open"));
  });

  // Инициализируем счетчик при загрузке
  applyDescriptionLimit(dom.inputDesc?.value || "");
}

function bindEditorActions() {
  const setTooltipPosition = (el) => {
    const rect = el.getBoundingClientRect();
    const left = rect.left + rect.width / 2;
    const top = rect.bottom + 8;
    el.style.setProperty("--tooltip-left", `${left}px`);
    el.style.setProperty("--tooltip-top", `${top}px`);
  };

  const applyTooltipText = () => {
    document.querySelectorAll("[data-tooltip-key]").forEach((el) => {
      const key = el.dataset.tooltipKey;
      if (!key) return;
      const text = tooltipText[key];
      if (text) {
        el.setAttribute("data-tooltip", text);
        if (!el.dataset.tooltipBound) {
          const handlePosition = () => setTooltipPosition(el);
          el.addEventListener("pointerenter", handlePosition);
          el.addEventListener("focus", handlePosition);
          el.addEventListener("touchstart", handlePosition);
          el.dataset.tooltipBound = "1";
        }
      }
    });
  };

  const bindSettingsAccordion = () => {
    const toggles = document.querySelectorAll("[data-settings-toggle]");
    toggles.forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const section = toggle.closest("[data-settings-section]");
        if (!section) return;
        const body = section.querySelector("[data-settings-body]");
        const isOpen = !section.classList.contains("is-open");
        section.classList.toggle("is-open", isOpen);
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (body) body.toggleAttribute("hidden", !isOpen);
      });
    });
  };

  dom.btnBack?.addEventListener("click", () => {
    if (state.isPerformance) return;
    if (state.sceneDirty) {
      showLeaveConfirm();
      return;
    }
    exitEditorToProjects();
  });

  dom.btnAddButton?.addEventListener("click", handleAddButton);
  dom.btnTemplates?.addEventListener("click", () => {
    if (state.isPerformance) return;
    openTemplateListModal();
  });
  dom.btnSaveTemplate?.addEventListener("click", () => {
    if (state.isPerformance) return;
    openTemplateSaveModal();
  });
  dom.templateSaveCancel?.addEventListener("click", closeTemplateSaveModal);
  dom.templateSaveConfirm?.addEventListener("click", saveTemplateFromModal);
  dom.templateListCancel?.addEventListener("click", closeTemplateListModal);
  dom.templateApply?.addEventListener("click", applyTemplateToProject);
  dom.templateList?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-template-id]");
    if (!card) return;
    templateSelectionId = card.dataset.templateId;
    const cards = dom.templateList.querySelectorAll(".template-card");
    cards.forEach((el) => el.classList.toggle("selected", el === card));
    if (dom.templateApply) dom.templateApply.disabled = false;
  });
  dom.templateSaveModal?.addEventListener("click", (event) => {
    if (event.target === dom.templateSaveModal) closeTemplateSaveModal();
  });
  dom.templateListModal?.addEventListener("click", (event) => {
    if (event.target === dom.templateListModal) closeTemplateListModal();
  });
  dom.leaveSave?.addEventListener("click", async () => {
    hideLeaveConfirm();
    await saveScene();
    exitEditorToProjects();
  });
  dom.leaveDiscard?.addEventListener("click", () => {
    setSceneDirty(false);
    hideLeaveConfirm();
    exitEditorToProjects();
  });
  dom.leaveStay?.addEventListener("click", hideLeaveConfirm);
  dom.btnSaveScene?.addEventListener("click", () => {
    if (state.isPerformance) return;
    saveScene();
  });
  dom.btnStopAll?.addEventListener("click", stopAllAudio);
  dom.btnDeleteButtonPanel?.addEventListener("click", deleteSelectedButton);
  dom.btnCopyColor?.addEventListener("click", () => {
    const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
    if (btn?.color) {
      state.copiedColor = btn.color;
    }
  });
  dom.btnPasteColor?.addEventListener("click", () => {
    if (!state.copiedColor) return;
    const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
    if (!btn) return;
    btn.color = state.copiedColor;
    if (dom.inputColor) dom.inputColor.value = state.copiedColor;
    if (dom.inputColorValue) dom.inputColorValue.textContent = state.copiedColor;
    renderGrid();
  });
  dom.btnToggleList?.addEventListener("click", () => {
    if (!state.isPerformance) return;
    state.perfListMode = !state.perfListMode;
    updateListToggleVisibility();
    renderGrid();
  });

  dom.waveLoopToggle?.addEventListener("change", () => {
    if (!state.currentWaveTrackId) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found) return;
    const seg = resolveSegment(found.track, state.waveDuration);
    updateTrackSegment(state.currentWaveTrackId, {
      ...seg,
      loop: dom.waveLoopToggle.checked,
      reverse: dom.waveReverseToggle?.checked,
    });
    setSceneDirty(true);
    drawWaveform(found.track, state.waveBuffers.get(state.currentWaveTrackId)?.peaks || [], state.waveDuration);
  });

  const updateWaveNormalizeUi = (track) => {
    if (!dom.waveNormalizeActions || !dom.waveNormalizeStatus) return;
    if (!track) {
      dom.waveNormalizeActions.hidden = true;
      dom.waveNormalizeStatus.textContent = "";
      return;
    }
    const hasNormalized = Boolean(track.normalizedFile);
    dom.waveNormalizeActions.hidden = !hasNormalized;
    if (!hasNormalized) {
      dom.waveNormalizeStatus.textContent = "";
      return;
    }
    dom.waveNormalizeStatus.textContent = track.useNormalized
      ? "Используется нормализованная версия."
      : "Нормализованная версия готова.";
    if (dom.waveNormalizePlayNormalized) dom.waveNormalizePlayNormalized.disabled = !hasNormalized;
    if (dom.waveNormalizeKeepNormalized) dom.waveNormalizeKeepNormalized.disabled = !hasNormalized;
    state.wavePreviewFile = track.useNormalized ? track.normalizedFile : track.file;
  };

  dom.waveReverseToggle?.addEventListener("change", () => {
    if (!state.currentWaveTrackId) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found) return;
    const seg = resolveSegment(found.track, state.waveDuration);
    updateTrackSegment(state.currentWaveTrackId, {
      ...seg,
      reverse: dom.waveReverseToggle.checked,
      loop: dom.waveLoopToggle?.checked,
    });
    setSceneDirty(true);
    drawWaveform(found.track, state.waveBuffers.get(state.currentWaveTrackId)?.peaks || [], state.waveDuration);
  });
  dom.waveCloseBtn?.addEventListener("click", closeWavePopover);
  dom.waveBackdrop?.addEventListener("click", (event) => {
    if (event.target === dom.waveBackdrop) closeWavePopover();
  });
  dom.wavePlayBtn?.addEventListener("click", playWavePreview);
  dom.waveNormalizeBtn?.addEventListener("click", async () => {
    if (!state.currentWaveTrackId || !state.currentProject) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found) return;
    if (!window.stagepadAPI?.normalizeAudio) {
      if (dom.waveNormalizeStatus) dom.waveNormalizeStatus.textContent = "Нормализация недоступна.";
      if (dom.waveNormalizeActions) dom.waveNormalizeActions.hidden = false;
      return;
    }
    const track = found.track;
    if (!track?.file) return;
    dom.waveNormalizeBtn.disabled = true;
    if (dom.waveNormalizeStatus) dom.waveNormalizeStatus.textContent = "Нормализация...";
    if (dom.waveNormalizeActions) dom.waveNormalizeActions.hidden = false;
    stopWavePreview();
    try {
      const normalized = await window.stagepadAPI.normalizeAudio(state.currentProject.id, track.file, { targetI: -14 });
      track.normalizedFile = normalized;
      track.useNormalized = false;
      setSceneDirty(true);
      updateWaveNormalizeUi(track);
    } catch (error) {
      if (dom.waveNormalizeStatus) {
        dom.waveNormalizeStatus.textContent = error?.message || "Не удалось нормализовать трек";
      }
    } finally {
      dom.waveNormalizeBtn.disabled = false;
    }
  });
  dom.waveNormalizePlayOriginal?.addEventListener("click", () => {
    if (!state.currentWaveTrackId) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found?.track?.file) return;
    state.wavePreviewFile = found.track.file;
    playWavePreview();
  });
  dom.waveNormalizePlayNormalized?.addEventListener("click", () => {
    if (!state.currentWaveTrackId) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found?.track?.normalizedFile) return;
    state.wavePreviewFile = found.track.normalizedFile;
    playWavePreview();
  });
  dom.waveNormalizeKeepOriginal?.addEventListener("click", () => {
    if (!state.currentWaveTrackId) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found?.track) return;
    found.track.useNormalized = false;
    setSceneDirty(true);
    clearPreloadCache({ skipActive: true });
    updateWaveNormalizeUi(found.track);
  });
  dom.waveNormalizeKeepNormalized?.addEventListener("click", () => {
    if (!state.currentWaveTrackId) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found?.track?.normalizedFile) return;
    found.track.useNormalized = true;
    found.track.loudnessGainDb = 0;
    setSceneDirty(true);
    clearPreloadCache({ skipActive: true });
    updateWaveNormalizeUi(found.track);
  });
  dom.waveCanvas?.addEventListener(
    "wheel",
    (event) => {
      if (!state.waveDuration) return;
      event.preventDefault();
      const delta = Math.sign(event.deltaY);
      const zoomFactor = delta > 0 ? 1 / 1.1 : 1.1;
      const rect = dom.waveCanvas.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      const viewDuration = Math.max(0.1, state.waveDuration / Math.max(1, state.waveZoom));
      const maxPan = Math.max(0, state.waveDuration - viewDuration);
      const viewStart = Math.max(0, Math.min(state.wavePan, maxPan));
      const focusTime = viewStart + ratio * viewDuration;
      state.waveZoom = Math.max(1, Math.min(20, state.waveZoom * zoomFactor));
      const newViewDuration = Math.max(0.1, state.waveDuration / Math.max(1, state.waveZoom));
      state.wavePan = Math.max(
        0,
        Math.min(focusTime - ratio * newViewDuration, state.waveDuration - newViewDuration)
      );
      if (state.currentWaveTrackId) {
        const found = findTrackById(state.currentWaveTrackId);
        if (found) drawWaveform(found.track, state.waveBuffers.get(found.track.id)?.peaks || [], state.waveDuration);
      }
    },
    { passive: false }
  );
  dom.waveCanvas?.addEventListener("mousedown", (event) => {
    if (event.button === 1) {
      state.waveIsPanning = true;
      state.wavePanStart = event.clientX;
      dom.waveCanvas.style.cursor = "grabbing";
      event.preventDefault();
    }
  });
  dom.waveCanvas?.addEventListener("mousemove", (event) => {
    if (state.waveIsPanning && state.waveDuration) {
      const rect = dom.waveCanvas.getBoundingClientRect();
      const deltaPx = event.clientX - state.wavePanStart;
      state.wavePanStart = event.clientX;
      const viewDuration = Math.max(0.1, state.waveDuration / Math.max(1, state.waveZoom));
      const deltaTime = (deltaPx / rect.width) * viewDuration;
      state.wavePan = Math.max(0, Math.min(state.wavePan - deltaTime, Math.max(0, state.waveDuration - viewDuration)));
      if (state.currentWaveTrackId) {
        const found = findTrackById(state.currentWaveTrackId);
        if (found) drawWaveform(found.track, state.waveBuffers.get(found.track.id)?.peaks || [], state.waveDuration);
      }
    }
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 1 && state.waveIsPanning) {
      state.waveIsPanning = false;
      if (dom.waveCanvas) dom.waveCanvas.style.cursor = "grab";
    }
    if (event.button === 0 && state.waveMouseDown) {
      state.waveMouseDown = false;
      state.waveSelectionMode = null;
      state.waveLastTime = null;
    }
  });

  window.addEventListener("keydown", (event) => {
    const playlistPickerVisible = dom.playlistPickModal && !dom.playlistPickModal.hidden;
    if (playlistPickerVisible && event.key === "Escape") {
      closePlaylistPicker();
      return;
    }
    const wavePopoverVisible = dom.wavePopover && !dom.wavePopover.hidden;
    if (wavePopoverVisible) {
      if (event.code === "Space") {
        event.preventDefault();
        if (state.wavePreviewAudio) {
          stopWavePreview();
        } else {
          playWavePreview();
        }
        return;
      }
      if (!state.currentWaveTrackId) return;
      const found = findTrackById(state.currentWaveTrackId);
      if (!found) return;
      const seg = resolveSegment(found.track, state.waveDuration);
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        const step = (seg.end - seg.start) / 100 || 0.05;
        const delta = event.code === "ArrowLeft" ? -step : step;
        const t = (state.waveStartMarker != null ? state.waveStartMarker : seg.start) + delta;
        setStartMarker(t, found.track);
      }
      return;
    }

    if (state.isPerformance) {
      if (event.key === "Escape") {
        if (dom.perfFontModal && !dom.perfFontModal.hidden) {
          dom.perfFontModal.hidden = true;
        } else if (dom.perfFontModal) {
          dom.perfFontModal.hidden = false;
          if (dom.perfFontModalInput) {
            dom.perfFontModalInput.value = state.perfFontSize;
            dom.perfFontModalInput.focus();
          }
          if (dom.perfFontModalValue) dom.perfFontModalValue.textContent = `${state.perfFontSize} px`;
          updatePreloadToggleUI();
          updatePerfDefaultViewUI();
          updateAlwaysOnTopUI();
          updateClickActionsUI();
        }
      }
      return;
    }

    if (event.key === "Escape") {
      if (dom.gridModal && !dom.gridModal.hidden) {
        closeGridModal();
      } else {
        openGridModal();
        dom.gridColsInput?.focus();
      }
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!state.isPerformance || event.key !== "Escape") return;
    const playlistPickerVisible = dom.playlistPickModal && !dom.playlistPickModal.hidden;
    const wavePopoverVisible = dom.wavePopover && !dom.wavePopover.hidden;
    const gridModalVisible = dom.gridModal && !dom.gridModal.hidden;
    const perfFontVisible = dom.perfFontModal && !dom.perfFontModal.hidden;
    if (playlistPickerVisible || wavePopoverVisible || gridModalVisible || perfFontVisible) return;
    toggleEscapeModal();
  });

  dom.stageGrid?.addEventListener("click", (event) => {
    const btnEl = event.target.closest("[data-id]");
    if (btnEl) {
      if (state.isPerformance) {
        playButton(btnEl.dataset.id);
      } else {
        selectButton(btnEl.dataset.id);
      }
    }
  });

  dom.stageGrid?.addEventListener("dblclick", (event) => {
    if (state.isPerformance) return;
    const cellEl = event.target.closest(".stage-cell");
    if (!cellEl) return;
    const { row, col } = cellEl.dataset;
    handleCreateAtSlot(Number(row), Number(col));
  });

  dom.stageGrid?.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const btnEl = event.target.closest("[data-id]");
    if (btnEl) {
      event.preventDefault();
      if (state.isPerformance) {
        const behavior = state.perfClickMiddleAction || "pause";
        playButton(btnEl.dataset.id, behavior);
      } else {
        // В редакторе средняя кнопка мыши имитирует обычное воспроизведение, как ЛКМ в перфомансе
        playButton(btnEl.dataset.id);
      }
    }
  });

  dom.stageGrid?.addEventListener("contextmenu", (event) => {
    if (!state.isPerformance) return;
    const btnEl = event.target.closest("[data-id]");
    if (btnEl) {
      event.preventDefault();
      const behavior = state.perfClickRightAction || "stop";
      playButton(btnEl.dataset.id, behavior);
    }
  });

  dom.stageGrid?.addEventListener("dragstart", (event) => {
    if (state.isPerformance) {
      event.preventDefault();
      return;
    }
    const btnEl = event.target.closest("[data-id]");
    if (!btnEl) return;
    state.draggingButtonId = btnEl.dataset.id;
    state.draggingCopy = Boolean(event.ctrlKey || event.metaKey);
    const btn = state.scene.buttons.find((b) => b.id === state.draggingButtonId);
    if (!btn) return;
    // Разрешаем все типы дропа, чтобы ОС не блокировала между окнами
    event.dataTransfer.effectAllowed = "all";
    const payload = { projectId: state.currentProject?.id, button: btn };
    const payloadStr = JSON.stringify(payload);
    event.dataTransfer.setData("text/plain", payloadStr);
    event.dataTransfer.setData("text", payloadStr);
    if (state.currentProject) {
      event.dataTransfer.setData("application/stagepad-button", payloadStr);
      event.dataTransfer.setData("text/stagepad-button", payloadStr);
    }
  });

  dom.stageGrid?.addEventListener("dragover", (event) => {
    if (state.isPerformance) return;
    event.preventDefault();
    const types = Array.from(event.dataTransfer?.types || []);
    const hasExternalStagepad =
      types.includes("application/stagepad-button") ||
      types.includes("text/stagepad-button") ||
      types.includes("text/plain") ||
      types.includes("text");
    if (state.draggingButtonId) {
      event.dataTransfer.dropEffect = state.draggingCopy ? "copy" : "move";
    } else if (hasExternalStagepad) {
      event.dataTransfer.dropEffect = "copy";
    } else {
      event.dataTransfer.dropEffect = "copy";
    }
  });

  dom.stageGrid?.addEventListener("drop", async (event) => {
    if (state.isPerformance) return;
    event.preventDefault();
    const cell = event.target.closest(".stage-cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const dropBtn = getButtonAt(row, col);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0 && dropBtn) {
      selectButton(dropBtn.id);
      openImportModal(Array.from(files)).then((tracks) => {
        if (tracks) {
          dropBtn.tracks.push(...tracks);
          selectButton(dropBtn.id);
          setSceneDirty(true);
        }
      });
      return;
    }

    const payloadStr =
      event.dataTransfer?.getData("application/stagepad-button") ||
      event.dataTransfer?.getData("text/stagepad-button");
    const plainData = !payloadStr ? event.dataTransfer?.getData("text/plain") : null;
    if (payloadStr) {
      try {
        const payload = JSON.parse(payloadStr);
        if (payload?.projectId && payload?.button && state.currentProject && payload.projectId !== state.currentProject.id) {
          await importButtonFromProject(payload, row, col);
          state.draggingButtonId = null;
          state.draggingCopy = false;
          return;
        }
      } catch (error) {
        console.error("Не удалось распарсить перенос кнопки между проектами:", error);
      }
    } else if (plainData) {
      try {
        const payload = JSON.parse(plainData);
        if (payload?.projectId && payload?.button && state.currentProject && payload.projectId !== state.currentProject.id) {
          await importButtonFromProject(payload, row, col);
          state.draggingButtonId = null;
          state.draggingCopy = false;
          return;
        }
      } catch (error) {
        // plain data мог быть не JSON — игнорируем
      }
    }

    if (state.draggingButtonId != null) {
      if (state.draggingCopy) {
        duplicateButton(state.draggingButtonId, row, col);
      } else {
        moveButton(state.draggingButtonId, row, col);
      }
      state.draggingButtonId = null;
      state.draggingCopy = false;
    }
  });

  dom.stageGrid?.addEventListener("dragend", () => {
    state.draggingButtonId = null;
    state.draggingCopy = false;
  });

  dom.playlistList?.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest("[data-track-delete]");
    if (deleteBtn) {
      deleteTrack(deleteBtn.dataset.trackDelete);
    }
    const previewBtn = event.target.closest("[data-track-preview]");
    if (previewBtn) {
      togglePlaylistPreview(previewBtn.dataset.trackPreview);
      return;
    }
    const selectBtn = event.target.closest("[data-track-select]");
    if (selectBtn) {
      await showWaveform(selectBtn.dataset.trackSelect);
      updateWaveNormalizeUi(findTrackById(state.currentWaveTrackId)?.track || null);
    }
  });

  dom.playlistList?.addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-track-id]");
    if (!item) return;
    state.draggingTrackId = item.dataset.trackId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.draggingTrackId);
  });

  dom.playlistList?.addEventListener("dragover", (event) => {
    if (!state.draggingTrackId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  dom.playlistList?.addEventListener("drop", (event) => {
    if (!state.draggingTrackId) return;
    event.preventDefault();
    const target = event.target.closest("[data-track-id]");
    if (target) {
      reorderTracks(state.draggingTrackId, target.dataset.trackId);
    }
    state.draggingTrackId = null;
  });

  dom.playlistList?.addEventListener("dragend", () => {
    state.draggingTrackId = null;
  });

  dom.playlistPickList?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-track-index]");
    if (!item) return;
    if (state.playlistPickerButtonId == null) return;
    const idx = Number(item.dataset.trackIndex);
    if (Number.isNaN(idx)) return;
    const targetButtonId = state.playlistPickerButtonId;
    closePlaylistPicker();
    playButton(targetButtonId, "restart", { forceTrackIndex: idx });
  });

  dom.playlistPickClose?.addEventListener("click", () => {
    closePlaylistPicker();
  });

  dom.playlistPickModal?.addEventListener("click", (event) => {
    if (event.target === dom.playlistPickModal) {
      closePlaylistPicker();
    }
  });

  dom.playlistExpandBtn?.addEventListener("click", () => {
    togglePlaylistExpanded();
  });

  let waveMouseDown = false;
  dom.waveCanvas?.addEventListener("mousedown", (event) => {
    if (event.button === 1) return;
    if (event.button !== 0 || !state.currentWaveTrackId) return;
    waveMouseDown = true;
    startWaveInteraction(event.clientX);
  });
  dom.waveCanvas?.addEventListener("dblclick", (event) => {
    if (!state.currentWaveTrackId) return;
    const found = findTrackById(state.currentWaveTrackId);
    if (!found) return;
    const time = timeFromClientX(event.clientX);
    setStartMarker(time, found.track);
    playWavePreview();
  });
  dom.waveCanvas?.addEventListener("contextmenu", (event) => {
    if (!state.currentWaveTrackId) return;
    event.preventDefault();
    const found = findTrackById(state.currentWaveTrackId);
    if (!found) return;
    const seg = resolveSegment(found.track, state.waveDuration);
    setStartMarker(seg.loop ? seg.start : 0, found.track);
  });
  dom.waveCanvas?.addEventListener("mousemove", (event) => {
    if (!waveMouseDown) return;
    continueWaveInteraction(event.clientX);
    setSceneDirty(true);
  });
  window.addEventListener("mouseup", () => {
    if (!waveMouseDown) return;
    waveMouseDown = false;
    stopWaveInteraction();
  });

  const enterEditMode = () => {
    if (!dom.waveNameView || !dom.waveNameEdit) return;
    dom.waveNameView.hidden = true;
    dom.waveNameEdit.hidden = false;
    if (dom.waveNameStack) dom.waveNameStack.classList.add("editing");
    dom.waveTrackNameInput?.focus();
    if (dom.waveTrackNameInput) {
      const len = dom.waveTrackNameInput.value.length;
      dom.waveTrackNameInput.selectionStart = len;
      dom.waveTrackNameInput.selectionEnd = len;
    }
  };

  const exitEditMode = () => {
    if (!dom.waveNameView || !dom.waveNameEdit) return;
    dom.waveNameView.hidden = false;
    dom.waveNameEdit.hidden = true;
    if (dom.waveNameStack) dom.waveNameStack.classList.remove("editing");
    if (dom.waveTrackNameInput) {
      dom.waveTrackNameInput.blur();
    }
  };

  const saveTrackName = () => {
    const found = state.currentWaveTrackId ? findTrackById(state.currentWaveTrackId) : null;
    if (found) {
      const value = dom.waveTrackNameInput?.value || "";
      const nextName = value.trim() || found.track.file || "";
      found.track.label = nextName;
      if (dom.waveTrackLabel) {
        dom.waveTrackLabel.textContent = nextName || "Трек";
      }
      renderPlaylist();
      renderGrid();
      renderProperties();
      setSceneDirty(true);
    }
    exitEditMode();
  };

  const cancelEditName = () => {
    const found = state.currentWaveTrackId ? findTrackById(state.currentWaveTrackId) : null;
    const current = found?.track?.label || found?.track?.file || "";
    if (dom.waveTrackNameInput) dom.waveTrackNameInput.value = current;
    exitEditMode();
  };

  dom.waveNameEditBtn?.addEventListener("click", enterEditMode);
  dom.waveNameSaveBtn?.addEventListener("click", saveTrackName);
  dom.waveNameCancelBtn?.addEventListener("click", cancelEditName);
  dom.waveTrackNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveTrackName();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditName();
    }
  });

  window.stagepadAPI?.onStopMusicGlobal?.((payload) => {
    console.warn("[stagepad][loop] stop-music-global", payload);
    const fadeLimit = Math.max(0, Number(payload?.fadeLimit) || 0);
    stopMusicPlayers(null, { fadeLimit, force: fadeLimit <= 0, skipUndo: true });
  });

  dom.perfFontModal?.addEventListener("click", (event) => {
    if (event.target === dom.perfFontModal) {
      dom.perfFontModal.hidden = true;
    }
  });

  dom.perfDefaultView?.addEventListener("change", (e) => {
    const val = e.target.value === "list";
    state.perfDefaultListMode = val;
    if (state.currentProject) state.currentProject.perfDefaultListMode = val;
    const cachedProject = state.projects.find((p) => p.id === state.currentProject?.id);
    if (cachedProject) cachedProject.perfDefaultListMode = val;
    if (state.isPerformance && state.scene) {
      state.scene.perfSettings = {
        ...(state.scene.perfSettings || {}),
        perfDefaultListMode: val,
      };
    }
    state.perfListMode = val;
    localStorage.setItem("stagepadPerfDefaultView", val ? "list" : "grid");
    updateListToggleVisibility();
    applyGridCss();
    renderGrid();
  });

  dom.perfPreloadToggle?.addEventListener("click", () => {
    if (!state.isPerformance) return;
    togglePreload(!state.preloadEnabled);
    updatePreloadToggleUI();
  });

  dom.perfAlwaysOnTopToggle?.addEventListener("change", (e) => {
    if (!state.isPerformance) return;
    applyAlwaysOnTopSetting(e.target.checked);
  });

  dom.perfClickMiddleSelect?.addEventListener("change", async (e) => {
    if (!state.isPerformance) return;
    const val = normalizeClickAction(e.target.value, "restart");
    state.perfClickMiddleAction = val;
    await persistClickActions({ middle: val });
  });

  dom.perfClickRightSelect?.addEventListener("change", async (e) => {
    if (!state.isPerformance) return;
    const val = normalizeClickAction(e.target.value, "open-playlist");
    state.perfClickRightAction = val;
    await persistClickActions({ right: val });
  });

  dom.perfFontModalInput?.addEventListener("input", (e) => {
    state.perfFontSize = Math.max(10, Math.min(32, Number(e.target.value) || state.perfFontSize));
    if (dom.perfFontModalValue) dom.perfFontModalValue.textContent = `${state.perfFontSize} px`;
    if (dom.perfFontValue) dom.perfFontValue.textContent = `${state.perfFontSize} px`;
    persistPerfFontSize();
    refreshPerfFontSize();
  });

  dom.perfPreloadCheckbox?.addEventListener("change", () => {
    togglePreload(dom.perfPreloadCheckbox.checked);
    updatePreloadToggleUI();
  });

  dom.perfListCheckbox?.addEventListener("change", () => {
    state.perfDefaultListMode = dom.perfListCheckbox.checked;
    if (state.currentProject) state.currentProject.perfDefaultListMode = state.perfDefaultListMode;
    const cachedProject = state.projects.find((p) => p.id === state.currentProject?.id);
    if (cachedProject) cachedProject.perfDefaultListMode = state.perfDefaultListMode;
    if (state.isPerformance && state.scene) {
      state.scene.perfSettings = {
        ...(state.scene.perfSettings || {}),
        perfDefaultListMode: state.perfDefaultListMode,
      };
    }
    localStorage.setItem("stagepadPerfDefaultView", state.perfDefaultListMode ? "list" : "grid");
    if (state.isPerformance) {
      state.perfListMode = state.perfDefaultListMode;
      renderGrid();
    }
    updatePerfDefaultViewUI();
  });

  dom.perfFontModalClose?.addEventListener("click", () => {
    if (dom.perfFontModal) dom.perfFontModal.hidden = true;
  });

  dom.perfFontSizeInput?.addEventListener("input", (e) => {
    state.perfFontSize = Math.max(10, Math.min(32, Number(e.target.value) || 18));
    if (dom.perfFontValue) dom.perfFontValue.textContent = `${state.perfFontSize} px`;
    persistPerfFontSize();
    refreshPerfFontSize({ render: state.isPerformance });
  });

  dom.btnResetUsage?.addEventListener("click", () => {
    resetUsageFlags();
    renderGrid();
    persistUsageFlags();
  });

  bindPlayingClick(dom.playingListEl);
  bindPlayingClick(dom.playingFloatingEl);
  bindPlayingClick(dom.playingModalList);

  dom.inputLabel?.addEventListener("input", (e) => updateButtonField("label", e.target.value));
  dom.inputType?.addEventListener("change", (e) => updateButtonField("type", e.target.value));
  dom.inputOnClick?.addEventListener("change", (e) => updateButtonField("onClickBehavior", e.target.value));
  dom.inputPlayMode?.addEventListener("change", (e) => updateButtonField("playMode", e.target.value));
  dom.inputAudioGroup?.addEventListener("change", (e) => updateButtonField("audioGroup", Number(e.target.value)));
  dom.inputColor?.addEventListener("input", (e) => updateButtonField("color", e.target.value));
  dom.inputColorValue?.addEventListener("input", (e) => updateButtonField("color", e.target.value));
  dom.inputColorAlpha?.addEventListener("input", (e) => updateButtonField("colorAlpha", e.target.value));
  dom.inputMarkUsageSelect?.addEventListener("change", (e) => {
    const value = e.target.value === "mark";
    updateButtonField("markUsed", value);
    const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
    if (!btn) return;
    btn.usedOnce = false;
    persistUsageFlags();
  });
  dom.playlistMode?.addEventListener("change", (e) => updateButtonField("playlistMode", e.target.value));
  dom.repeatGapInput?.addEventListener("input", (e) => updateButtonField("repeatGap", Number(e.target.value) || 0));
  dom.fadeInToggle?.addEventListener("change", (e) =>
    updateButtonField("fadeIn", e.target.checked ? Number(dom.fadeInDuration.value) : 0)
  );
  dom.fadeOutToggle?.addEventListener("change", (e) =>
    updateButtonField("fadeOut", e.target.checked ? Number(dom.fadeOutDuration.value) : 0)
  );
  dom.fadeInDuration?.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    if (dom.fadeInToggle?.checked) updateButtonField("fadeIn", val);
    updateFadeLabels();
  });
  dom.fadeOutDuration?.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    if (dom.fadeOutToggle?.checked) updateButtonField("fadeOut", val);
    updateFadeLabels();
  });

  bindSettingsAccordion();
  applyTooltipText();

  dom.btnAddTrack?.addEventListener("click", () => {
    if (!state.selectedButtonId) {
      if (dom.propertiesError) dom.propertiesError.textContent = "Сначала выберите кнопку.";
      return;
    }
    dom.fileInput?.click();
  });

  dom.fileInput?.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const tracks = await openImportModal(files);
    if (tracks && state.selectedButtonId) {
      const btn = state.scene.buttons.find((b) => b.id === state.selectedButtonId);
      if (btn) {
        btn.tracks.push(...tracks);
        selectButton(btn.id);
        setSceneDirty(true);
      }
    }
    dom.fileInput.value = "";
  });

  dom.gridSave?.addEventListener("click", () => {
    const cols = Math.max(1, Math.min(20, Number(dom.gridColsInput.value) || DEFAULT_COLS));
    const rows = Math.max(1, Math.min(20, Number(dom.gridRowsInput.value) || DEFAULT_ROWS));
    state.gridCols = cols;
    state.gridRows = rows;
    applyGridCss();
    clampButtonsToGrid();
    renderGrid();
    renderProperties();
    setSceneDirty(true);
    closeGridModal();
  });

  dom.btnCleanupUnused?.addEventListener("click", cleanupUnusedFiles);
  dom.btnSortByName?.addEventListener("click", () => {
    sortButtonsByName();
  });
  dom.gridCancel?.addEventListener("click", closeGridModal);

  const isEditableTarget = (target) => {
    if (!target) return false;
    const tag = target.tagName ? target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return Boolean(target.isContentEditable);
  };

  window.addEventListener("keydown", (event) => {
    if (!state.isPerformance) return;
    if (isEditableTarget(event.target)) return;
    const hotkey = parseHotkey(state.perfUndoHotkey);
    if (!matchesHotkey(event, hotkey)) return;
    event.preventDefault();
    undoLastMusicPlay();
  });
}

function clampMixerIndex(index) {
  const num = Number(index);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(11, Math.round(num)));
}

function getMixerGroupNames() {
  try {
    const raw = localStorage.getItem(MIXER_NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === 12) {
      return parsed.map((name, idx) => String(name || (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`)));
    }
  } catch (_) {
    /* ignore */
  }
  return Array.from({ length: 12 }, (_, idx) => (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`));
}

const clampDb = (value, min, max) => Math.max(min, Math.min(max, value));

function gainToSlider(value) {
  const gain = clampDb(Number(value) || 0, 0.000001, 1);
  const db = 20 * Math.log10(gain);
  return clampDb((db - MIXER_MIN_DB) / (MIXER_MAX_DB - MIXER_MIN_DB), 0, 1);
}

function buildUsedGroups() {
  const used = new Set();
  (state.scene?.buttons || []).forEach((btn) => {
    const hasAudio = Boolean((btn?.tracks && btn.tracks.length) || btn?.file);
    if (!hasAudio) return;
    const group = typeof btn.audioGroup === "number" ? clampMixerIndex(btn.audioGroup) : 0;
    used.add(group);
  });
  return Array.from(used);
}

function buildActiveGroups() {
  const active = new Set();
  state.players.forEach((entry) => {
    if (entry?.audio && !entry.audio.paused) {
      active.add(clampMixerIndex(entry.group));
    }
  });
  return Array.from(active);
}

function buildRemoteButtonsPayload() {
  if (!state.scene?.buttons) return [];
  return state.scene.buttons.map((btn) => {
    const player = state.players.get(btn.id);
    const isPlaying =
      (player?.audio && player.audio.paused === false && player.audio.ended !== true) ||
      player?.isPlaying === true;
    const progress =
      player && typeof player.progress === "number"
        ? Math.max(0, Math.min(1, player.progress))
        : 0;
    return {
      id: btn.id,
      label: btn.label || "Кнопка",
      color: btn.color || "#00ffa6",
      colorAlpha: typeof btn.colorAlpha === "number" ? btn.colorAlpha : 1,
      position: typeof btn.position === "number" ? btn.position : null,
      playing: isPlaying,
      progress,
      markUsed: Boolean(btn.markUsed),
      usedOnce: Boolean(btn.usedOnce),
    };
  });
}

function sendRemoteState() {
  if (!window.stagepadAPI?.sendRemoteState) return;
  if (!state.isPerformance || !state.currentProject) return;
  window.stagepadAPI.sendRemoteState({
    projectId: state.currentProject.id,
    grid: { rows: state.gridRows, cols: state.gridCols },
    buttons: buildRemoteButtonsPayload(),
    usedGroups: buildUsedGroups(),
    activeGroups: buildActiveGroups(),
    mixerGroups: Array.isArray(state.mixerGroups) ? state.mixerGroups : [],
    mixerSliders: Array.isArray(state.mixerGroups)
      ? state.mixerGroups.map((val) => gainToSlider(val))
      : [],
    groupNames: getMixerGroupNames(),
  });
}

function ensureRemoteStateTimer() {
  if (remoteStateTimer) return;
  remoteStateTimer = setInterval(() => {
    if (!state.isPerformance) return;
    sendRemoteState();
  }, REMOTE_STATE_INTERVAL);
}

function init(options = {}) {
  appPage = options.page || "combined";
  const forcedProjectId = options.projectId || startupProjectId || null;
  const forcePerformance = Boolean(options.forcePerformance ?? (appPage === "performance" || startupPerformance));
  const forceEditor = Boolean(options.forceEditor ?? appPage === "editor");
  const setWindowFocusState = () => {
    document.body.classList.toggle("window-focused", document.hasFocus());
  };
  bindWindowControls();
  if (appPage !== "combined" && appPage !== "projects" && !forcedProjectId) {
    window.location.replace("projects.html");
    return;
  }
  state.isPerformance = forcePerformance;
  if (state.isPerformance) {
    state.perfListMode = state.perfDefaultListMode;
  }
  if (state.isPerformance) {
    sendRemoteState();
  }
  // Синхронизируем локальный кэш кликов, если их нет в localStorage
  if (state.perfClickMiddleAction) {
    localStorage.setItem("stagepadPerfClickMiddle", state.perfClickMiddleAction);
  }
  if (state.perfClickRightAction) {
    localStorage.setItem("stagepadPerfClickRight", state.perfClickRightAction);
  }

  document.body.classList.toggle("performance-mode", state.isPerformance);
  ensureModalsHidden();
  applyGridCss();
  setSceneDirty(false);
  updatePreloadToggleUI();
  updateAlwaysOnTopUI();
  coverWindowActive = false;
  setCoverState(false, null);
  renderProjects();
  updateListToggleVisibility();

  const bootstrap = async () => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      await loadProjects();
      const startedPerf = await tryStartupPerformance(forcedProjectId, forcePerformance);
      if (!startedPerf) {
        await tryStartupEditor(forcedProjectId, forceEditor);
      }
      if (state.isPerformance) {
        sendRemoteState();
      }
    })().finally(() => {
      bootstrapPromise = null;
    });
    return bootstrapPromise;
  };

  bootstrap();
  setWindowFocusState();
  ensureRemoteStateTimer();
  window.addEventListener("focus", () => {
    setWindowFocusState();
    bootstrap();
  });
  window.addEventListener("blur", () => {
    setWindowFocusState();
  });
  window.addEventListener("resize", () => {
    if (state.isPerformance) {
      renderGrid();
    } else {
      updateLayoutMode();
      ensureButtonContentFits();
      requestAnimationFrame(() => ensureButtonContentFits());
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "stagepadAudioOutputEditor") {
      state.audioOutputEditor = event.newValue || "";
    } else if (event.key === "stagepadAudioOutputPerformance") {
      state.audioOutputPerformance = event.newValue || "";
    } else if (event.key === "stagepadMixerGroups") {
      try {
        const parsed = event.newValue ? JSON.parse(event.newValue) : null;
        if (Array.isArray(parsed) && parsed.length === 12) {
          state.mixerGroups = parsed.map((val, idx) =>
            isFinite(val) ? Math.max(0, Math.min(1, Number(val))) : state.mixerGroups?.[idx] ?? 1
          );
        }
      } catch (_) {
        /* ignore */
      }
      refreshGroupVolumes();
      applyMixerGroupNames();
    } else if (event.key === "stagepadMixerGroupNames") {
      applyMixerGroupNames();
    } else if (event.key === "stagepadUndoHotkey") {
      state.perfUndoHotkey = event.newValue || "Ctrl+Alt+Z";
    } else if (event.key === "stagepadNormalizationEnabled") {
      state.normalizationEnabled = event.newValue !== "0";
      console.info("[stagepad][loudness] normalization", {
        enabled: state.normalizationEnabled,
      });
      refreshGroupVolumes();
    } else if (event.key === COVER_STATE_KEY) {
      try {
        const payload = event.newValue ? JSON.parse(event.newValue) : null;
        coverWindowActive = Boolean(payload?.open);
        updateCoverToggleUI();
      } catch (_) {
        /* ignore */
      }
    }
  });

  if (window.stagepadAPI?.onCoverState) {
    window.stagepadAPI.onCoverState((payload) => {
      if (!payload) return;
      setCoverState(Boolean(payload.open), payload.projectId || null);
    });
  }

  if (window.stagepadAPI?.onRemoteCommand) {
    window.stagepadAPI.onRemoteCommand((payload) => {
      if (!payload || !state.isPerformance) return;
      if (payload.type === "press-button" && payload.buttonId) {
        playButton(payload.buttonId, payload.action || null);
        return;
      }
      if (payload.type === "reset-used") {
        resetUsageFlags();
        renderGrid();
        persistUsageFlags();
        sendRemoteState();
        return;
      }
      if (payload.type === "set-mixer-group") {
        const index = clampMixerIndex(payload.index);
        const rawValue = Number(payload.value);
        const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(1, rawValue)) : 1;
        if (!Array.isArray(state.mixerGroups)) {
          state.mixerGroups = [];
        }
        state.mixerGroups[index] = value;
        localStorage.setItem("stagepadMixerGroups", JSON.stringify(state.mixerGroups));
        refreshGroupVolumes();
        sendRemoteState();
      }
    });
  }

  bindProjectActions();
  bindEditorActions();
  applyMixerGroupNames();
}

export function initApp(options = {}) {
  init(options);
}
