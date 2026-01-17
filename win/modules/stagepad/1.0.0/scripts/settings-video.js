const DEFAULT_PREFS = { workDisplayId: null, performanceDisplayId: null, coverFormat: "16:9", updatedAt: null };
const COVER_FORMAT_KEY = "stagepadCoverFormat";
const COVER_FORMATS = [
  { value: "16:9", label: "16:9 (широкий)" },
  { value: "4:3", label: "4:3 (классический)" },
  { value: "1:1", label: "1:1 (квадрат)" },
  { value: "9:16", label: "9:16 (вертикальный)" },
];

const normalizePrefs = (prefs) => ({
  workDisplayId: prefs?.workDisplayId ? String(prefs.workDisplayId) : null,
  performanceDisplayId: prefs?.performanceDisplayId ? String(prefs.performanceDisplayId) : null,
  coverFormat: prefs?.coverFormat || DEFAULT_PREFS.coverFormat,
  updatedAt: prefs?.updatedAt || null,
});

const formatDisplayLabel = (display, index) => {
  const parts = [];
  if (display?.label) {
    parts.push(display.label);
  } else {
    parts.push(`Экран ${index + 1}`);
  }
  const size =
    display?.bounds && display.bounds.width && display.bounds.height
      ? `${display.bounds.width}x${display.bounds.height}`
      : "";
  if (size) parts.push(size);
  if (display?.isPrimary) parts.push("основной");
  return parts.join(" · ");
};

async function fetchDisplays() {
  if (!window.stagepadAPI?.listDisplays) return [];
  try {
    return await window.stagepadAPI.listDisplays();
  } catch (error) {
    console.error("Не удалось получить список дисплеев:", error);
    return [];
  }
}

async function fetchPrefs() {
  if (!window.stagepadAPI?.getDisplayPreferences) return { ...DEFAULT_PREFS };
  try {
    const prefs = await window.stagepadAPI.getDisplayPreferences();
    return normalizePrefs(prefs || {});
  } catch (error) {
    console.error("Не удалось получить сохраненные настройки дисплеев:", error);
    return { ...DEFAULT_PREFS };
  }
}

async function persistPrefs(patch) {
  if (!window.stagepadAPI?.saveDisplayPreferences) return normalizePrefs(patch || {});
  try {
    const prefs = await window.stagepadAPI.saveDisplayPreferences(patch || {});
    return normalizePrefs(prefs || {});
  } catch (error) {
    console.error("Не удалось сохранить настройки дисплеев:", error);
    return normalizePrefs(patch || {});
  }
}

function fillSelect(select, displays, savedId, { placeholder } = {}) {
  select.innerHTML = "";
  const normalizedId = savedId ? String(savedId) : "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = placeholder || "Текущий экран системы";
  defaultOpt.selected = !normalizedId;
  select.append(defaultOpt);

  displays.forEach((display, index) => {
    const opt = document.createElement("option");
    opt.value = String(display.id);
    opt.textContent = formatDisplayLabel(display, index);
    if (normalizedId && String(display.id) === normalizedId) {
      opt.selected = true;
    }
    select.append(opt);
  });

  const hasSaved = normalizedId && Array.from(select.options || []).some((opt) => opt.value === normalizedId);
  if (normalizedId && !hasSaved) {
    const opt = document.createElement("option");
    opt.value = normalizedId;
    opt.textContent = `Отключен (${normalizedId})`;
    opt.selected = true;
    select.append(opt);
    select.setAttribute("data-missing", "true");
  } else {
    select.removeAttribute("data-missing");
  }
}

export function render(container) {
  const wrap = document.createElement("div");
  wrap.className = "settings-card";

  const title = document.createElement("h3");
  title.textContent = "Видео";
  wrap.appendChild(title);

  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = "Выберите, на какие дисплеи выводить рабочее и перфоманс-окна StagePad.";
  wrap.appendChild(description);

  const grid = document.createElement("div");
  grid.className = "field-grid";

  const workField = document.createElement("div");
  workField.className = "field";
  const workLabel = document.createElement("label");
  workLabel.textContent = "Рабочий экран (редактор)";
  const workSelect = document.createElement("select");
  workSelect.className = "select";
  workField.append(workLabel, workSelect);

  const perfField = document.createElement("div");
  perfField.className = "field";
  const perfLabel = document.createElement("label");
  perfLabel.textContent = "Экран перфоманса";
  const perfSelect = document.createElement("select");
  perfSelect.className = "select";
  perfField.append(perfLabel, perfSelect);

  const formatField = document.createElement("div");
  formatField.className = "field";
  const formatLabel = document.createElement("label");
  formatLabel.textContent = "Формат обложки";
  const formatSelect = document.createElement("select");
  formatSelect.className = "select";
  COVER_FORMATS.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    formatSelect.append(option);
  });
  formatField.append(formatLabel, formatSelect);

  grid.append(workField, perfField, formatField);

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const refreshBtn = document.createElement("button");
  refreshBtn.className = "btn secondary small";
  refreshBtn.textContent = "Обновить список экранов";
  const status = document.createElement("div");
  status.className = "settings-note";
  status.textContent = "Список экранов загружается…";
  actions.append(refreshBtn, status);

  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent =
    "Настройки сохраняются локально и восстанавливаются при повторном подключении выбранного монитора.";

  wrap.append(grid, actions, note);
  container.appendChild(wrap);

  const state = {
    displays: [],
    prefs: { ...DEFAULT_PREFS },
  };

  const updateStatus = () => {
    const missingWork =
      state.prefs.workDisplayId &&
      !state.displays.some((d) => String(d.id) === state.prefs.workDisplayId);
    const missingPerf =
      state.prefs.performanceDisplayId &&
      !state.displays.some((d) => String(d.id) === state.prefs.performanceDisplayId);
    if (!state.displays.length) {
      status.textContent = "Экраны не найдены. Подключите дисплей и обновите список.";
      return;
    }
    if (missingWork || missingPerf) {
      status.textContent = "Сохраненный экран не найден — выберите заново или подключите его обратно.";
      return;
    }
    status.textContent = "Выбор экранов сохранен.";
  };

  const renderSelects = () => {
    fillSelect(workSelect, state.displays, state.prefs.workDisplayId, { placeholder: "Текущий основной экран" });
    fillSelect(perfSelect, state.displays, state.prefs.performanceDisplayId, { placeholder: "Текущий основной экран" });
    formatSelect.value = state.prefs.coverFormat || DEFAULT_PREFS.coverFormat;
    localStorage.setItem(COVER_FORMAT_KEY, formatSelect.value);
    updateStatus();
  };

  const loadData = async () => {
    status.textContent = "Обновляем список экранов…";
    const [prefs, displays] = await Promise.all([fetchPrefs(), fetchDisplays()]);
    state.prefs = prefs;
    state.displays = displays || [];
    renderSelects();
  };

  workSelect.addEventListener("change", async () => {
    const next = await persistPrefs({ workDisplayId: workSelect.value || null, performanceDisplayId: state.prefs.performanceDisplayId });
    state.prefs = next;
    renderSelects();
  });

  perfSelect.addEventListener("change", async () => {
    const next = await persistPrefs({ workDisplayId: state.prefs.workDisplayId, performanceDisplayId: perfSelect.value || null });
    state.prefs = next;
    renderSelects();
  });

  formatSelect.addEventListener("change", async () => {
    const next = await persistPrefs({
      workDisplayId: state.prefs.workDisplayId,
      performanceDisplayId: state.prefs.performanceDisplayId,
      coverFormat: formatSelect.value || DEFAULT_PREFS.coverFormat,
    });
    state.prefs = next;
    localStorage.setItem(COVER_FORMAT_KEY, state.prefs.coverFormat || DEFAULT_PREFS.coverFormat);
    renderSelects();
  });

  refreshBtn.addEventListener("click", loadData);

  loadData();
}
