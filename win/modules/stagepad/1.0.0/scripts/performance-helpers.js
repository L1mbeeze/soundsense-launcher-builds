import { ensureApi } from "./api.js";
import { dom } from "./dom.js";
import { applyGridCss, renderGrid } from "./editor.js";
import { state } from "./state.js";

export function updatePreloadToggleUI() {
  if (dom.perfPreloadToggle) {
    dom.perfPreloadToggle.textContent = `Предзагрузка: ${state.preloadEnabled ? "вкл" : "выкл"}`;
    dom.perfPreloadToggle.setAttribute("aria-pressed", state.preloadEnabled ? "true" : "false");
  }
  if (dom.perfPreloadCheckbox) {
    dom.perfPreloadCheckbox.checked = Boolean(state.preloadEnabled);
  }
}

export function updatePerfDefaultViewUI() {
  if (dom.perfDefaultView) {
    dom.perfDefaultView.value = state.perfDefaultListMode ? "list" : "grid";
  }
  if (dom.perfListCheckbox) {
    dom.perfListCheckbox.checked = Boolean(state.perfDefaultListMode);
  }
}

export function updateAlwaysOnTopUI() {
  if (dom.perfAlwaysOnTopToggle) {
    dom.perfAlwaysOnTopToggle.checked = Boolean(state.perfAlwaysOnTop);
  }
}

const CLICK_ACTIONS = new Set(["restart", "pause", "stop", "open-playlist"]);
export const normalizeClickAction = (action, fallback = "restart") => (CLICK_ACTIONS.has(action) ? action : fallback);

export function updateClickActionsUI() {
  if (dom.perfClickMiddleSelect) dom.perfClickMiddleSelect.value = state.perfClickMiddleAction || "restart";
  if (dom.perfClickRightSelect) dom.perfClickRightSelect.value = state.perfClickRightAction || "pause";
}

export function persistPerfFontSize() {
  if (!ensureApi() || !state.currentProject) return;
  state.currentProject.perfFontSize = state.perfFontSize;
  const cachedProject = state.projects.find((p) => p.id === state.currentProject.id);
  if (cachedProject) cachedProject.perfFontSize = state.perfFontSize;
  if (state.isPerformance && state.scene) {
    state.scene.perfSettings = {
      ...(state.scene.perfSettings || {}),
      perfFontSize: state.perfFontSize,
    };
  }
  try {
    const result = window.stagepadAPI?.setProjectPerfFontSize?.(state.currentProject.id, state.perfFontSize);
    if (result?.then) {
      result.catch((error) => console.error("Не удалось сохранить размер шрифта проекта:", error));
    }
  } catch (error) {
    console.error("Не удалось сохранить размер шрифта проекта:", error);
  }
}

export async function persistClickActions({ middle = state.perfClickMiddleAction, right = state.perfClickRightAction } = {}) {
  if (!ensureApi() || !state.currentProject) return;
  state.perfClickMiddleAction = normalizeClickAction(middle, "restart");
  state.perfClickRightAction = normalizeClickAction(right, "open-playlist");
  state.currentProject.perfClickMiddleAction = state.perfClickMiddleAction;
  state.currentProject.perfClickRightAction = state.perfClickRightAction;
  localStorage.setItem("stagepadPerfClickMiddle", state.perfClickMiddleAction);
  localStorage.setItem("stagepadPerfClickRight", state.perfClickRightAction);
  localStorage.setItem(
    `stagepadPerfClicks_${state.currentProject.id}`,
    JSON.stringify({ middle: state.perfClickMiddleAction, right: state.perfClickRightAction })
  );
  // Обновляем кэш списка проектов, чтобы новые действия подхватывались при повторных загрузках
  const project = state.projects.find((p) => p.id === state.currentProject.id);
  if (project) {
    project.perfClickMiddleAction = state.perfClickMiddleAction;
    project.perfClickRightAction = state.perfClickRightAction;
  }
  if (state.isPerformance && state.scene) {
    state.scene.perfSettings = {
      ...(state.scene.perfSettings || {}),
      clickMiddle: state.perfClickMiddleAction,
      clickRight: state.perfClickRightAction,
    };
    try {
      await window.stagepadAPI?.saveScene?.(state.currentProject.id, {
        buttons: state.scene.buttons,
        grid: { rows: state.gridRows, cols: state.gridCols },
        perfSettings: state.scene.perfSettings,
      });
    } catch (error) {
      console.error("Не удалось сохранить действия в сцену:", error);
    }
  }
  try {
    await window.stagepadAPI?.setProjectClickActions?.(state.currentProject.id, {
      middle: state.perfClickMiddleAction,
      right: state.perfClickRightAction,
    });
  } catch (error) {
    console.error("Не удалось сохранить действия кнопок мыши:", error);
  }
}

export function refreshPerfFontSize({ render = true } = {}) {
  applyGridCss();
  if (dom.stageGrid) {
    dom.stageGrid.getBoundingClientRect();
  }
  if (render) {
    renderGrid();
  }
}

export async function applyAlwaysOnTopSetting(enabled, { persist = true } = {}) {
  const nextValue = Boolean(enabled);
  state.perfAlwaysOnTop = nextValue;
  if (persist) {
    localStorage.setItem("stagepadPerfAlwaysOnTop", nextValue ? "1" : "0");
    if (state.currentProject) {
      state.currentProject.perfAlwaysOnTop = nextValue;
      const cachedProject = state.projects.find((p) => p.id === state.currentProject.id);
      if (cachedProject) cachedProject.perfAlwaysOnTop = nextValue;
    }
    if (state.isPerformance && state.scene) {
      state.scene.perfSettings = {
        ...(state.scene.perfSettings || {}),
        perfAlwaysOnTop: nextValue,
      };
    }
  }
  updateAlwaysOnTopUI();
  if (!state.isPerformance || !ensureApi()) return;
  try {
    await window.stagepadAPI.setAlwaysOnTop(nextValue);
  } catch (error) {
    console.error("Не удалось переключить режим поверх всех окон:", error);
  }
}
