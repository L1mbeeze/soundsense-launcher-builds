const UNDO_HOTKEY_KEY = "stagepadUndoHotkey";
const DEFAULT_UNDO_HOTKEY = "Ctrl+Alt+Z";

const normalizeToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === " ") return "Space";
  const lower = raw.toLowerCase();
  if (lower === "control") return "Ctrl";
  if (lower === "altgraph") return "Alt";
  if (lower === "meta") return "Meta";
  if (lower === "shift") return "Shift";
  if (lower === "alt") return "Alt";
  if (lower === "ctrl") return "Ctrl";
  if (lower === "space") return "Space";
  if (lower.startsWith("arrow")) {
    return `Arrow${lower.slice(5, 6).toUpperCase()}${lower.slice(6)}`;
  }
  if (raw.length === 1) return raw.toUpperCase();
  return raw;
};

const buildHotkeyLabel = (event) => {
  if (!event) return "";
  const key = event.key;
  const ignore = ["Shift", "Control", "Alt", "Meta"];
  if (!key || ignore.includes(key)) return "";
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const keyLabel = normalizeToken(key);
  if (!keyLabel) return "";
  parts.push(keyLabel);
  return parts.join("+");
};

const loadHotkey = () => localStorage.getItem(UNDO_HOTKEY_KEY) || DEFAULT_UNDO_HOTKEY;
const saveHotkey = (value) => localStorage.setItem(UNDO_HOTKEY_KEY, value || DEFAULT_UNDO_HOTKEY);

export function render(container) {
  if (!container) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <h2>Управление</h2>
    <div class="settings-card">
      <div class="field">
        <label for="undoHotkeyInput">Откат последнего запуска музыки</label>
        <input id="undoHotkeyInput" type="text" readonly>
        <p class="settings-note">Нажмите сочетание клавиш в этом поле, чтобы назначить хоткей отката.</p>
      </div>
      <div class="settings-actions">
        <button class="btn secondary" id="undoHotkeyReset" type="button">Сбросить</button>
      </div>
    </div>
  `;
  container.appendChild(wrapper);

  const input = wrapper.querySelector("#undoHotkeyInput");
  const resetBtn = wrapper.querySelector("#undoHotkeyReset");
  if (!input) return;
  input.value = loadHotkey();

  input.addEventListener("keydown", (event) => {
    event.preventDefault();
    const next = buildHotkeyLabel(event);
    if (!next) return;
    input.value = next;
    saveHotkey(next);
  });

  resetBtn?.addEventListener("click", () => {
    input.value = DEFAULT_UNDO_HOTKEY;
    saveHotkey(DEFAULT_UNDO_HOTKEY);
  });
}
