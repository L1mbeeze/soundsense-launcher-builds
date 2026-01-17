const closeWindow = () => window.close();

const TAB_LOADERS = {
  audio: () => import("./settings-audio.js"),
  video: () => import("./settings-video.js"),
  controls: () => import("./settings-controls.js"),
};

let currentTab = "audio";
const moduleCache = new Map();
let windowControlsBound = false;

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

async function renderTab(tab) {
  const btns = Array.from(document.querySelectorAll(".tab-btn"));
  btns.forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const content = document.getElementById("settingsContent");
  if (!content) return;
  content.innerHTML = "";
  let mod = moduleCache.get(tab);
  if (!mod) {
    mod = await TAB_LOADERS[tab]();
    moduleCache.set(tab, mod);
  }
  mod?.render?.(content);
}

function initSettings() {
  bindWindowControls();
  const closeBtn = document.getElementById("settingsCloseBtn");
  closeBtn?.addEventListener("click", closeWindow);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeWindow();
    }
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = btn.dataset.tab;
      if (!tab || tab === currentTab) return;
      currentTab = tab;
      await renderTab(tab);
    });
  });

  renderTab(currentTab);
}

document.addEventListener("DOMContentLoaded", initSettings);
