const KEY = "stagepadMixerGroups";
const NAME_KEY = "stagepadMixerGroupNames";
const ACTIVE_KEY = "stagepadMixerActiveGroups";
const LEVELS_KEY = "stagepadMixerGroupLevels";
const PROJECT_GROUPS_PREFIX = "stagepadProjectGroups:";
const PROJECT_GROUPS_UPDATED_KEY = "stagepadProjectGroupsUpdated";
const DYNAMIC_FILTER_KEY = "stagepadMixerDynamicOnlyUsed";
const COVER_STATE_KEY = "stagepadCoverState";
const ACTIVE_PERF_PROJECT_KEY = "stagepadActivePerformanceProject";
const COLOR_KEY = "stagepadMixerGroupColors";
const GROUPS = 12;
const MIN_DB = -60;
const MAX_DB = 0;
const DEFAULT_COLOR = "#18ffb0";
const COLOR_PRESETS = [
  "#18ffb0",
  "#32b6ff",
  "#7a6cff",
  "#ff6bd6",
  "#ff6b6b",
  "#ff9f3a",
  "#ffd34a",
  "#9bff5b",
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const sliderToGain = (value) => {
  const v = clamp(Number(value) || 0, 0, 1);
  const db = MIN_DB + (MAX_DB - MIN_DB) * v;
  return Math.pow(10, db / 20);
};

const gainToSlider = (gain) => {
  const g = clamp(Number(gain) || 0, 0.000001, 1);
  const db = 20 * Math.log10(g);
  return clamp((db - MIN_DB) / (MAX_DB - MIN_DB), 0, 1);
};

const formatDb = (value) => {
  const v = clamp(Number(value) || 0, 0, 1);
  const db = MIN_DB + (MAX_DB - MIN_DB) * v;
  const rounded = Math.round(db);
  return `${rounded} dB`;
};

const loadGroups = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === GROUPS) {
      return parsed.map((val) => clamp(Number(val) || 0, 0, 1));
    }
  } catch (_) {
    /* ignore */
  }
  return Array.from({ length: GROUPS }, () => 1);
};

const saveGroups = (groups) => {
  localStorage.setItem(KEY, JSON.stringify(groups));
};

const loadNames = () => {
  try {
    const raw = localStorage.getItem(NAME_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === GROUPS) {
      return parsed.map((val, idx) => {
        if (typeof val === "string" && val.trim()) return val.trim();
        return idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`;
      });
    }
  } catch (_) {
    /* ignore */
  }
  return Array.from({ length: GROUPS }, (_, idx) => (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`));
};

const loadColors = () => {
  try {
    const raw = localStorage.getItem(COLOR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === GROUPS) {
      return parsed.map((val) => (typeof val === "string" && val.trim() ? val.trim() : DEFAULT_COLOR));
    }
  } catch (_) {
    /* ignore */
  }
  return Array.from({ length: GROUPS }, () => DEFAULT_COLOR);
};

const saveColors = (colors) => {
  localStorage.setItem(COLOR_KEY, JSON.stringify(colors));
};

const saveNames = (names) => {
  localStorage.setItem(NAME_KEY, JSON.stringify(names));
};

const loadDynamicFilter = () => localStorage.getItem(DYNAMIC_FILTER_KEY) === "1";

const saveDynamicFilter = (value) => {
  localStorage.setItem(DYNAMIC_FILTER_KEY, value ? "1" : "0");
};

const readCoverState = () => {
  try {
    const raw = localStorage.getItem(COVER_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

const applyCoverToggleState = (open) => {
  const toggle = document.getElementById("mixerCoverToggle");
  if (!toggle) return;
  toggle.checked = Boolean(open);
};

const loadActiveGroups = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      return new Set(parsed.map((val) => clamp(Number(val) || 0, 0, GROUPS - 1)));
    }
  } catch (_) {
    /* ignore */
  }
  return new Set();
};

const loadLevels = () => {
  try {
    const raw = localStorage.getItem(LEVELS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === GROUPS) {
      return parsed.map((val) => clamp(Number(val) || 0, 0, 1));
    }
  } catch (_) {
    /* ignore */
  }
  return Array.from({ length: GROUPS }, () => 0);
};

const applyGroupsToUi = (groups) => {
  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const fader = channel.querySelector(".mixer-fader");
    const valueLabel = channel.querySelector("[data-value]");
    const gain = groups[idx] ?? 1;
    const sliderValue = gainToSlider(gain);
    if (fader) {
      fader.value = sliderValue;
      fader.style.setProperty("--fader-percent", `${Math.round(sliderValue * 100)}%`);
    }
    if (valueLabel) valueLabel.textContent = formatDb(sliderValue);
  });
};

const applyLevelsToUi = (levels) => {
  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const level = levels[idx] ?? 0;
    channel.style.setProperty("--meter-level", String(Math.max(0, level)));
  });
};

const applyColorsToUi = (colors) => {
  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const color = colors[idx] || DEFAULT_COLOR;
    channel.style.setProperty("--channel-accent", color);
  });
};

const applyActiveGroups = (activeGroups) => {
  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const isActive = activeGroups.has(idx);
    channel.dataset.active = isActive ? "true" : "false";
  });
};

const getActiveSignature = (activeGroups) => JSON.stringify(Array.from(activeGroups).sort((a, b) => a - b));

const applyNamesToUi = (names) => {
  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const label = channel.querySelector(".mixer-label");
    if (label) label.value = names[idx] ?? (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`);
  });
};

const loadUsedGroupsFromProjects = () => {
  const used = new Set();
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PROJECT_GROUPS_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : null;
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      groups.forEach((val) => used.add(clamp(Number(val) || 0, 0, GROUPS - 1)));
    } catch (_) {
      /* ignore */
    }
  }
  return used;
};

const applyDynamicFilter = (onlyUsed) => {
  const usedGroups = loadUsedGroupsFromProjects();
  const hasUsed = usedGroups.size > 0;
  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const shouldHide = onlyUsed && (!hasUsed || !usedGroups.has(idx));
    channel.toggleAttribute("hidden", shouldHide);
  });
};

const bindFaders = (groups) => {
  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const fader = channel.querySelector(".mixer-fader");
    const valueLabel = channel.querySelector("[data-value]");
    if (!fader) return;
    const updateUi = () => {
      const gain = sliderToGain(fader.value);
      groups[idx] = gain;
      if (valueLabel) valueLabel.textContent = formatDb(fader.value);
      fader.style.setProperty("--fader-percent", `${Math.round(Number(fader.value) * 100)}%`);
      saveGroups(groups);
    };
    const onWheel = (event) => {
      event.preventDefault();
      const rawStep = Number(fader.step);
      const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 0.01;
      const delta = event.deltaY < 0 ? step : -step;
      const current = Number(fader.value) || 0;
      const next = clamp(current + delta, Number(fader.min) || 0, Number(fader.max) || 1);
      fader.value = String(next);
      updateUi();
    };
    fader.addEventListener("input", updateUi);
    fader.addEventListener("change", updateUi);
    fader.addEventListener("wheel", onWheel, { passive: false });
  });
};

const bindChannelConfig = (names, colors) => {
  const modal = document.getElementById("channelModal");
  const nameInput = document.getElementById("channelNameInput");
  const colorGrid = document.getElementById("channelColorGrid");
  const saveBtn = document.getElementById("channelSaveBtn");
  const cancelBtn = document.getElementById("channelCancelBtn");
  if (!modal || !nameInput || !colorGrid || !saveBtn || !cancelBtn) return;
  let editingIndex = null;
  let selectedColor = DEFAULT_COLOR;

  const renderColorGrid = () => {
    colorGrid.innerHTML = COLOR_PRESETS
      .map(
        (color) =>
          `<button type="button" class="mixer-color-swatch" data-color="${color}" style="--swatch-color:${color};" aria-label="${color}"></button>`
      )
      .join("");
  };

  const selectColor = (color) => {
    selectedColor = color || DEFAULT_COLOR;
    colorGrid.querySelectorAll(".mixer-color-swatch").forEach((btn) => {
      btn.dataset.selected = btn.dataset.color === selectedColor ? "true" : "false";
    });
  };

  renderColorGrid();

  const openModal = (idx) => {
    editingIndex = idx;
    nameInput.value = names[idx] || (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`);
    selectColor(colors[idx] || DEFAULT_COLOR);
    modal.hidden = false;
    nameInput.focus();
    nameInput.select();
  };

  const closeModal = () => {
    modal.hidden = true;
    editingIndex = null;
  };

  const saveChanges = () => {
    if (editingIndex == null) return;
    const idx = editingIndex;
    const nextName = String(nameInput.value || "").trim() || (idx >= 8 ? `FX ${idx - 7}` : `Bus ${idx + 1}`);
    const nextColor = String(selectedColor || "").trim() || DEFAULT_COLOR;
    names[idx] = nextName;
    colors[idx] = nextColor;
    saveNames(names);
    saveColors(colors);
    applyNamesToUi(names);
    applyColorsToUi(colors);
    closeModal();
  };

  document.querySelectorAll(".mixer-channel").forEach((channel) => {
    const idx = Number(channel.dataset.group) || 0;
    const label = channel.querySelector(".mixer-label");
    if (label) label.readOnly = true;
    channel.addEventListener("dblclick", () => openModal(idx));
  });

  colorGrid.addEventListener("click", (event) => {
    const btn = event.target.closest(".mixer-color-swatch");
    if (!btn) return;
    selectColor(btn.dataset.color);
  });

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) closeModal();
  });
  saveBtn.addEventListener("click", saveChanges);
  cancelBtn.addEventListener("click", closeModal);
  window.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    } else if (event.key === "Enter") {
      event.preventDefault();
      saveChanges();
    }
  });
};

const initMixer = () => {
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
  window.addEventListener("keydown", (event) => {
    if (event.key !== "F12") return;
    event.preventDefault();
    const controls = window.stagepadAPI?.windowControls || window.stagepadWindow?.windowControls;
    controls?.toggleDevTools?.();
  });
  const groups = loadGroups();
  const names = loadNames();
  const colors = loadColors();
  const activeGroups = loadActiveGroups();
  const levels = loadLevels();
  const dynamicFilterEnabled = loadDynamicFilter();
  let lastActiveSignature = getActiveSignature(activeGroups);
  let lastLevelSignature = JSON.stringify(levels);
  applyGroupsToUi(groups);
  applyNamesToUi(names);
  applyColorsToUi(colors);
  applyActiveGroups(activeGroups);
  applyLevelsToUi(levels);
  applyDynamicFilter(dynamicFilterEnabled);
  bindFaders(groups);
  bindChannelConfig(names, colors);

  const dynamicToggle = document.getElementById("mixerDynamicToggle");
  if (dynamicToggle) {
    dynamicToggle.checked = dynamicFilterEnabled;
    dynamicToggle.addEventListener("change", () => {
      const enabled = Boolean(dynamicToggle.checked);
      saveDynamicFilter(enabled);
      applyDynamicFilter(enabled);
    });
  }

  const coverToggle = document.getElementById("mixerCoverToggle");
  if (coverToggle) {
    applyCoverToggleState(readCoverState()?.open);
    coverToggle.addEventListener("change", async () => {
      if (!window.stagepadAPI) {
        coverToggle.checked = false;
        return;
      }
      const projectId = localStorage.getItem(ACTIVE_PERF_PROJECT_KEY) || null;
      try {
        if (coverToggle.checked) {
          await window.stagepadAPI.openCover(projectId);
        } else {
          await window.stagepadAPI.closeCover();
        }
      } catch (_) {
        coverToggle.checked = false;
      }
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === ACTIVE_KEY) {
      const next = loadActiveGroups();
      lastActiveSignature = getActiveSignature(next);
      applyActiveGroups(next);
    } else if (event.key === PROJECT_GROUPS_UPDATED_KEY || (event.key || "").startsWith(PROJECT_GROUPS_PREFIX)) {
      applyDynamicFilter(loadDynamicFilter());
    } else if (event.key === LEVELS_KEY) {
      const nextLevels = loadLevels();
      lastLevelSignature = JSON.stringify(nextLevels);
      applyLevelsToUi(nextLevels);
    } else if (event.key === COVER_STATE_KEY) {
      const next = readCoverState();
      applyCoverToggleState(next?.open);
    } else if (event.key === KEY) {
      applyGroupsToUi(loadGroups());
    } else if (event.key === NAME_KEY) {
      applyNamesToUi(loadNames());
    } else if (event.key === COLOR_KEY) {
      applyColorsToUi(loadColors());
    }
  });
  setInterval(() => {
    const next = loadActiveGroups();
    const signature = getActiveSignature(next);
    if (signature === lastActiveSignature) return;
    lastActiveSignature = signature;
    applyActiveGroups(next);
  }, 300);
  setInterval(() => {
    const nextLevels = loadLevels();
    const signature = JSON.stringify(nextLevels);
    if (signature === lastLevelSignature) return;
    lastLevelSignature = signature;
    applyLevelsToUi(nextLevels);
  }, 120);
  const closeBtn = document.getElementById("mixerCloseBtn");
  closeBtn?.addEventListener("click", () => window.close());

  if (window.stagepadAPI?.onCoverState) {
    window.stagepadAPI.onCoverState((payload) => {
      applyCoverToggleState(payload?.open);
    });
  }
};

document.addEventListener("DOMContentLoaded", initMixer);
