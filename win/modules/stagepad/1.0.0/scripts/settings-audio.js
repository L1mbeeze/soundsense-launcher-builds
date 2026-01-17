const KEY_EDITOR = "stagepadAudioOutputEditor";
const KEY_PERF = "stagepadAudioOutputPerformance";
const KEY_NORMALIZATION = "stagepadNormalizationEnabled";

const getSaved = (key) => localStorage.getItem(key) || "";
const save = (key, value) => localStorage.setItem(key, value || "");
const isNormalizationEnabled = () => localStorage.getItem(KEY_NORMALIZATION) !== "0";
const saveNormalization = (enabled) => localStorage.setItem(KEY_NORMALIZATION, enabled ? "1" : "0");

const formatLabel = (device) => device.label || `Устройство ${device.deviceId.slice(0, 6)}`;

async function loadOutputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audiooutput");
}

function buildSelect(devices, selected) {
  const select = document.createElement("select");
  select.className = "select";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Системное по умолчанию";
  select.appendChild(defaultOpt);
  devices.forEach((dev) => {
    const opt = document.createElement("option");
    opt.value = dev.deviceId;
    opt.textContent = formatLabel(dev);
    opt.selected = selected && selected === dev.deviceId;
    select.appendChild(opt);
  });
  return select;
}

export function render(container) {
  const wrap = document.createElement("div");
  wrap.className = "settings-card";
  const title = document.createElement("h3");
  title.textContent = "Аудио";
  wrap.appendChild(title);

  const editorField = document.createElement("div");
  const perfField = document.createElement("div");
  const normalizationField = document.createElement("div");
  editorField.className = "field";
  perfField.className = "field";
  normalizationField.className = "field";

  const editorLabel = document.createElement("label");
  editorLabel.textContent = "Аудиовыход для редактора";
  const perfLabel = document.createElement("label");
  perfLabel.textContent = "Аудиовыход для перформанса";
  const normalizationLabel = document.createElement("label");
  normalizationLabel.textContent = "Нормализация громкости (-14 LUFS)";

  editorField.appendChild(editorLabel);
  perfField.appendChild(perfLabel);
  normalizationField.appendChild(normalizationLabel);

  const normalizationToggle = document.createElement("input");
  normalizationToggle.type = "checkbox";
  normalizationToggle.checked = isNormalizationEnabled();
  normalizationToggle.addEventListener("change", () => {
    saveNormalization(normalizationToggle.checked);
  });
  normalizationField.appendChild(normalizationToggle);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "btn secondary small";
  refreshBtn.textContent = "Обновить устройства";
  refreshBtn.style.alignSelf = "flex-start";

  const renderSelects = async () => {
    const devices = await loadOutputs();
    editorField.querySelector("select")?.remove();
    perfField.querySelector("select")?.remove();
    const editorSelect = buildSelect(devices, getSaved(KEY_EDITOR));
    const perfSelect = buildSelect(devices, getSaved(KEY_PERF));
    editorSelect.addEventListener("change", () => {
      save(KEY_EDITOR, editorSelect.value);
    });
    perfSelect.addEventListener("change", () => {
      save(KEY_PERF, perfSelect.value);
    });
    editorField.appendChild(editorSelect);
    perfField.appendChild(perfSelect);
  };

  refreshBtn.addEventListener("click", renderSelects);

  wrap.appendChild(editorField);
  wrap.appendChild(perfField);
  wrap.appendChild(normalizationField);
  wrap.appendChild(refreshBtn);
  container.appendChild(wrap);

  renderSelects();
}
