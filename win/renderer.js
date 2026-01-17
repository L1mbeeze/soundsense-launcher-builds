const progressState = {
  percent: 0,
  text: "Готово",
};

const AUTH_STORAGE_KEY = "soundsense_auth_v1";
const AUTH_API_URL = "https://soundsense.pro/api/login.php";
const AUTH_REGISTER_URL = "https://soundsense.pro/api/register.php";
const SUBSCRIPTION_API_URL = "https://soundsense.pro/api/api.php";
const pageScripts = {};
const authState = {
  isAuthenticated: false,
  email: "",
  username: "",
  userId: null,
  sessionToken: "",
};
const subscriptionState = {
  loaded: false,
  active: false,
  remainingSeconds: 0,
  expiresAt: null,
  label: "",
};
let pendingAuthMessage = "";

let launcherUpdateData = null;
let playBtn = null;
let progressBar = null;
let progressTextEl = null;
let installLabel = "Установить";

function applyProgressState() {
  if (progressBar) {
    progressBar.style.width = `${progressState.percent}%`;
  }
  if (progressTextEl && !launcherUpdateData) {
    progressTextEl.innerText = progressState.text;
  }
  if (playBtn && !launcherUpdateData) {
    playBtn.innerText =
      progressState.percent >= 100 ? "Играть" : installLabel;
  }
}

function setupDefaultPlayBtn() {
  if (!playBtn) return;
  playBtn.onclick = () => window.electronAPI.checkUpdates();
}

function applyLauncherUpdateState() {
  if (!launcherUpdateData || !playBtn) return;

  const { remote, local } = launcherUpdateData;
  if (progressTextEl) {
    progressTextEl.innerText =
      `Доступна новая версия лаунчера: ${remote.version} (у вас ${local})`;
  }

  playBtn.innerText = "Обновить лаунчер";
  playBtn.onclick = () => {
    const platform = navigator.userAgent.includes("Mac") ? "mac" : "win";
    window.open(remote[platform]);
  };
}

function initInstallControls() {
  playBtn = document.getElementById("play-btn");
  progressBar = document.getElementById("progress-bar");
  progressTextEl = document.getElementById("progress-text");

  if (!playBtn || !progressBar || !progressTextEl) return;

  installLabel = playBtn.dataset.installLabel || "Установить";
  setupDefaultPlayBtn();
  applyProgressState();

  if (launcherUpdateData) {
    applyLauncherUpdateState();
  }
}

function clearPageRefs() {
  playBtn = null;
  progressBar = null;
  progressTextEl = null;
  installLabel = "Установить";
}

const soundSenseUI = (() => {
  let active = false;
  let refs = {};
  let state = null;
  let latestProgress = null;
  let progressUnsubscribe = null;
  let uiMessage = "";
  let uiMessageIsError = false;
  let messageTimer = null;
  let handlers = {};
  let actionRunning = false;
  let optimisticOperation = null;
  let deleteModalOpen = false;

  function queryRefs() {
    return {
      button: document.getElementById("play-btn"),
      size: document.getElementById("soundsense-size-label"),
      progress: document.getElementById("soundsense-progress"),
      progressBar: document.getElementById("soundsense-progress-bar"),
      progressText: document.getElementById("soundsense-progress-text"),
      message: document.getElementById("soundsense-message"),
      menuBtn: document.getElementById("soundsense-menu-btn"),
      menu: document.getElementById("soundsense-menu"),
      deleteModal: document.getElementById("soundsense-delete-modal"),
      deleteConfirm: document.getElementById("soundsense-delete-confirm"),
      deleteCancel: document.getElementById("soundsense-delete-cancel"),
      deleteProgress: document.getElementById("soundsense-delete-progress"),
      deleteProgressBar: document.getElementById("soundsense-delete-progress-bar"),
      deleteProgressText: document.getElementById("soundsense-delete-progress-text"),
    };
  }

  function ensureProgressListener() {
    if (progressUnsubscribe || !window.soundSenseAPI?.onProgress) return;
    progressUnsubscribe = window.soundSenseAPI.onProgress((payload) => {
      latestProgress = payload;
      if (active) {
        render();
      }
    });
  }

  function formatRemoteError(errorText) {
    if (!errorText) return "";
    return "Нет связи с сервером, показываем локальные данные.";
  }

  function setUiMessage(text, { isError = false, persist = false } = {}) {
    uiMessage = text || "";
    uiMessageIsError = Boolean(isError);
    if (messageTimer) {
      clearTimeout(messageTimer);
      messageTimer = null;
    }
    if (uiMessage && !persist) {
      messageTimer = setTimeout(() => {
        uiMessage = "";
        uiMessageIsError = false;
        if (active) render();
      }, isError ? 7000 : 4000);
    }
  }

  function render() {
    if (!active || !refs.button) return;

    const progressAction =
      latestProgress?.action || state?.operation || optimisticOperation;
    const showProgress =
      Boolean(progressAction) &&
      ["install", "verify", "launch"].includes(progressAction);

    if (!showProgress && !optimisticOperation) {
      latestProgress = null;
    }

    const isDeleteOperation = progressAction === "delete";
    const progressData = showProgress ? latestProgress : null;
    const rawPercent =
      showProgress && typeof progressData?.percent === "number"
        ? progressData.percent
        : 0;
    const clampedPercent = Math.max(0, Math.min(100, rawPercent));
    const statusText =
      progressData?.status ||
      (showProgress
        ? progressAction === "install"
          ? "Подготовка установки…"
          : "Подготовка проверки…"
        : "");
    const percentLabel = showProgress
      ? `${
          clampedPercent % 1 === 0
            ? clampedPercent.toFixed(0)
            : clampedPercent.toFixed(1)
        }%`
      : "";
    const showMainProgress = showProgress && !isDeleteOperation;

    if (refs.size) {
      refs.size.innerText = state?.buildSizeLabel || "Размер: —";
    }

    if (refs.progressBar) {
      refs.progressBar.style.width = `${showMainProgress ? clampedPercent : 0}%`;
    }
    if (refs.progressText) {
      const parts = [];
      if (showMainProgress && percentLabel) parts.push(percentLabel);
      if (statusText) parts.push(statusText);
      refs.progressText.innerText = parts.join(" · ");
    }
    if (refs.progress) {
      refs.progress.hidden = !showMainProgress;
    }

    let buttonLabel = "Установить";
    let disabled = false;
    if (progressAction === "install") {
      buttonLabel = "Установка…";
      disabled = true;
    } else if (progressAction === "verify" || progressAction === "launch") {
      buttonLabel = "Проверка…";
      disabled = true;
    } else if (!state?.installed) {
      buttonLabel = "Установить";
    } else if (!state?.executableExists) {
      buttonLabel = "Переустановить";
    } else {
      buttonLabel = "Играть";
    }
    refs.button.disabled = disabled || !window.soundSenseAPI || actionRunning;
    refs.button.innerText = buttonLabel;

    const shouldShowDeleteModal = deleteModalOpen || isDeleteOperation;
    if (refs.deleteModal) {
      refs.deleteModal.hidden = !shouldShowDeleteModal;
    }
    if (refs.deleteProgress && refs.deleteProgressBar) {
      refs.deleteProgress.hidden = !isDeleteOperation;
      refs.deleteProgressBar.style.width = `${isDeleteOperation ? clampedPercent : 0}%`;
    }
    if (refs.deleteProgressText) {
      if (isDeleteOperation) {
        const modalParts = [];
        if (percentLabel) modalParts.push(percentLabel);
        if (statusText) modalParts.push(statusText);
        refs.deleteProgressText.innerText = modalParts.join(" · ");
      } else {
        refs.deleteProgressText.innerText = "";
      }
    }
    if (refs.deleteConfirm) {
      refs.deleteConfirm.disabled = isDeleteOperation || actionRunning;
    }
    if (refs.deleteCancel) {
      refs.deleteCancel.disabled = isDeleteOperation;
    }

    const messages = [];
    const remoteErrorText = formatRemoteError(state?.remoteError);
    if (remoteErrorText) {
      messages.push(remoteErrorText);
    }
    if (uiMessage) {
      messages.push(uiMessage);
    }
    if (refs.message) {
      refs.message.innerText = messages.join(" ");
      if (messages.length > 0 && (uiMessageIsError || remoteErrorText)) {
        refs.message.dataset.variant = uiMessageIsError ? "error" : "info";
      } else if (refs.message.dataset.variant) {
        delete refs.message.dataset.variant;
      }
    }
  }

  async function refreshState() {
    if (!window.soundSenseAPI) return;
    try {
      state = await window.soundSenseAPI.getState();
      render();
    } catch (error) {
      setUiMessage(error?.message || "Не удалось получить статус", {
        isError: true,
        persist: true,
      });
      render();
    }
  }

  function cleanupHandlers() {
    if (refs.button && handlers.button) {
      refs.button.removeEventListener("click", handlers.button);
    }
    if (refs.menuBtn && handlers.menuBtn) {
      refs.menuBtn.removeEventListener("click", handlers.menuBtn);
    }
    if (refs.menu && handlers.menu) {
      refs.menu.removeEventListener("click", handlers.menu);
    }
    if (refs.deleteConfirm && handlers.deleteConfirm) {
      refs.deleteConfirm.removeEventListener("click", handlers.deleteConfirm);
    }
    if (refs.deleteCancel && handlers.deleteCancel) {
      refs.deleteCancel.removeEventListener("click", handlers.deleteCancel);
    }
    handlers = {};
  }

  function toggleMenu(forceState) {
    if (!refs.menu) return;
    const shouldOpen =
      typeof forceState === "boolean"
        ? forceState
        : refs.menu.hasAttribute("hidden");
    if (shouldOpen) {
      refs.menu.removeAttribute("hidden");
    } else {
      refs.menu.setAttribute("hidden", "true");
    }
  }

  async function performOperation(operationName, executor) {
    if (actionRunning) return;
    actionRunning = true;
    optimisticOperation = operationName;
    render();
    try {
      await executor();
    } finally {
      optimisticOperation = null;
      actionRunning = false;
      latestProgress = null;
      render();
    }
  }

  function openDeleteModal() {
    deleteModalOpen = true;
    render();
  }

  function closeDeleteModal(force = false) {
    if (!force && latestProgress?.action === "delete") return;
    deleteModalOpen = false;
    render();
  }

  async function runAction(actionName, actionFn) {
    if (!actionFn) return;
    try {
      setUiMessage("");
      const payload = await actionFn();
      const nextState = payload?.state || payload;
      if (nextState) {
        state = nextState;
      }
      if (actionName === "install") {
        setUiMessage("Установка завершена");
      } else if (actionName === "verify") {
        setUiMessage("Проверка завершена");
      } else if (payload?.launched) {
        setUiMessage("Игра запущена");
      } else if (actionName === "delete") {
        setUiMessage("Игра удалена");
      }
      render();
    } catch (error) {
      setUiMessage(error?.message || "Ошибка операции", {
        isError: true,
        persist: true,
      });
      render();
    }
  }

  async function handleMainButton() {
    if (!window.soundSenseAPI) return;
    const currentState = state || {
      installed: false,
      executableExists: false,
    };
    if (currentState.operation) return;

    const needsInstall =
      !currentState.installed || !currentState.executableExists;
    const operation = needsInstall ? "install" : "launch";

    await performOperation(operation, async () => {
      if (needsInstall) {
        await runAction("install", () => window.soundSenseAPI.install());
      } else {
        await runAction("launch", () => window.soundSenseAPI.launch());
      }
      await refreshState();
    });
  }

  async function handleMenuClick(event) {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    toggleMenu(false);
    if (action === "verify") {
      await performOperation("verify", async () => {
        await runAction("verify", () =>
          window.soundSenseAPI.checkIntegrity()
        );
        await refreshState();
      });
    } else if (action === "open-folder") {
      try {
        await window.soundSenseAPI.openFolder();
        setUiMessage("Папка игры открыта");
      } catch (error) {
        setUiMessage(error?.message || "Не удалось открыть папку", {
          isError: true,
          persist: true,
        });
      }
      render();
    } else if (action === "delete") {
      openDeleteModal();
    }
  }

  async function handleDeleteConfirm() {
    if (!window.soundSenseAPI) return;
    await performOperation("delete", async () => {
      await runAction("delete", () => window.soundSenseAPI.deleteGame());
      await refreshState();
    });
    closeDeleteModal(true);
  }

  function handleDeleteCancel() {
    closeDeleteModal();
  }

  return {
    async mount() {
      if (!window.soundSenseAPI) return;
      active = true;
      ensureProgressListener();
      refs = queryRefs();
      handlers = {};
      actionRunning = false;
      optimisticOperation = null;
      deleteModalOpen = false;
      if (!refs.button) {
        active = false;
        refs = {};
        return;
      }
      handlers.button = handleMainButton;
      refs.button.addEventListener("click", handlers.button);
      if (refs.menuBtn) {
        handlers.menuBtn = () => toggleMenu();
        refs.menuBtn.addEventListener("click", handlers.menuBtn);
      }
      if (refs.menu) {
        handlers.menu = handleMenuClick;
        refs.menu.addEventListener("click", handlers.menu);
      }
      if (refs.deleteConfirm) {
        handlers.deleteConfirm = handleDeleteConfirm;
        refs.deleteConfirm.addEventListener("click", handlers.deleteConfirm);
      }
      if (refs.deleteCancel) {
        handlers.deleteCancel = handleDeleteCancel;
        refs.deleteCancel.addEventListener("click", handlers.deleteCancel);
      }
      await refreshState();
    },
    unmount() {
      active = false;
      actionRunning = false;
      optimisticOperation = null;
      deleteModalOpen = false;
      cleanupHandlers();
      refs = {};
    },
    handleGlobalClick(event) {
      if (!active) return;
      const isMenu =
        refs.menu &&
        (refs.menu === event.target || refs.menu.contains(event.target));
      const clickedMenuBtn = Boolean(
        event.target.closest("#soundsense-menu-btn")
      );
      if (
        refs.menu &&
        !event.target.closest("#soundsense-menu") &&
        refs.menuBtn &&
        !clickedMenuBtn &&
        !isMenu
      ) {
        refs.menu.setAttribute("hidden", "true");
      }
    },
  };
})();

function setupPage(pageName) {
  clearPageRefs();
  soundSenseUI.unmount();
  if (pageName === "game_soundsense") {
    soundSenseUI.mount();
  } else if (pageName === "auth") {
    initAuthTabs();
    initAuthForms();
  } else if (pageName === "home") {
    initHomePage();
  } else if (pageName === "profile") {
    initProfilePage();
  } else if (pageName === "stagepad") {
    initStagepadPage();
  } else {
    initInstallControls();
  }
}

function initAuthTabs() {
  const tabs = Array.from(document.querySelectorAll("[data-auth-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-auth-panel]"));
  if (tabs.length === 0 || panels.length === 0) return;

  const setActive = (target) => {
    tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab === target);
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.authPanel !== target.dataset.authTab;
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActive(tab));
  });

  const initialTab = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
  setActive(initialTab);
}

function initAuthForms() {
  const loginBtn = document.getElementById("auth-login-btn");
  const emailInput = document.getElementById("auth-email");
  const passInput = document.getElementById("auth-password");
  const loginForm = document.querySelector('[data-auth-panel="login"]');
  const registerBtn = document.getElementById("auth-register-btn");
  const registerUsernameInput = document.getElementById("auth-register-username");
  const registerEmailInput = document.getElementById("auth-register-email");
  const registerPassInput = document.getElementById("auth-register-password");
  const registerPassRepeatInput = document.getElementById("auth-register-password-repeat");
  const registerForm = document.querySelector('[data-auth-panel="register"]');

  if (pendingAuthMessage) {
    setAuthMessage(pendingAuthMessage, { isError: true });
    pendingAuthMessage = "";
  }

  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  if (!loginBtn || !emailInput || !passInput) return;

  loginBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      setAuthMessage("Заполните все поля", { isError: true });
      return;
    }
    loginBtn.disabled = true;
    setAuthMessage("Входим...");
    try {
      const response = await loginWithEmailPassword(email, password);
      if (response?.status === "success") {
        setAuthState({
          isAuthenticated: true,
          email,
          username: response.username || "",
          userId: response.user_id || null,
          sessionToken: response.session_pc || "",
        });
        saveAuthToStorage();
        setAuthMessage("Вход выполнен");
        loadPage("home");
      } else {
        setAuthMessage(response?.message || "Ошибка авторизации", { isError: true });
      }
    } catch (error) {
      setAuthMessage(error?.message || "Ошибка сети", { isError: true });
    } finally {
      loginBtn.disabled = false;
    }
  });

  if (
    !registerBtn ||
    !registerUsernameInput ||
    !registerEmailInput ||
    !registerPassInput ||
    !registerPassRepeatInput
  ) {
    return;
  }

  registerBtn.addEventListener("click", async () => {
    const username = registerUsernameInput.value.trim();
    const email = registerEmailInput.value.trim();
    const password = registerPassInput.value;
    const repeatPassword = registerPassRepeatInput.value;

    if (!username || !email || !password || !repeatPassword) {
      setRegisterMessage("Заполните все поля", { isError: true });
      return;
    }
    if (password !== repeatPassword) {
      setRegisterMessage("Пароли не совпадают", { isError: true });
      return;
    }

    registerBtn.disabled = true;
    setRegisterMessage("Создаем аккаунт...");
    try {
      const response = await registerAccount({
        username,
        email,
        password,
      });
      if (response?.status === "success") {
        setRegisterMessage("Регистрация успешна. Теперь войдите.");
        registerPassInput.value = "";
        registerPassRepeatInput.value = "";
        setAuthTabsActive("login");
        if (emailInput) {
          emailInput.value = email;
          if (passInput) passInput.focus();
        }
      } else {
        setRegisterMessage(response?.message || "Ошибка регистрации", { isError: true });
      }
    } catch (error) {
      setRegisterMessage(error?.message || "Ошибка сети", { isError: true });
    } finally {
      registerBtn.disabled = false;
    }
  });
}

function initProfilePage() {
  const emailEl = document.getElementById("profile-email");
  const logoutBtn = document.getElementById("profile-logout-btn");

  if (emailEl) emailEl.innerText = authState.email || "—";

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearAuthState();
      loadPage("auth");
    });
  }

  const profileScriptUrl = new URL("pages/profile.js", window.location.href);
  loadScriptOnce(profileScriptUrl.href).then(() => {
    if (window.profilePage?.init) {
      window.profilePage.init({
        email: authState.email,
        username: authState.username,
        subscriptionText: subscriptionState.label || "Проверяем...",
      });
    }
  });

  refreshSubscriptionState()
    .then((state) => {
      const label = state.label || "Нет данных";
      if (window.profilePage?.setSubscriptionText) {
        window.profilePage.setSubscriptionText(label);
      } else {
        const subscriptionEl = document.getElementById("profile-subscription");
        if (subscriptionEl) subscriptionEl.innerText = label;
      }
    })
    .catch(() => {
      const fallback = "Нет связи с сервером";
      if (window.profilePage?.setSubscriptionText) {
        window.profilePage.setSubscriptionText(fallback);
      } else {
        const subscriptionEl = document.getElementById("profile-subscription");
        if (subscriptionEl) subscriptionEl.innerText = fallback;
      }
    });
}

function initStagepadPage() {
  const stagepadScriptUrl = new URL("pages/stagepad.js", window.location.href);
  loadScriptOnce(stagepadScriptUrl.href).then(() => {
    if (window.stagepadPage?.init) {
      window.stagepadPage.init({
        subscription: subscriptionState.loaded ? subscriptionState : null,
      });
    }
  });

  refreshSubscriptionState()
    .then((state) => {
      if (window.stagepadPage?.setSubscriptionState) {
        window.stagepadPage.setSubscriptionState(state);
      }
    })
    .catch(() => {
      if (window.stagepadPage?.setSubscriptionState) {
        window.stagepadPage.setSubscriptionState({
          active: false,
          label: "Нет связи с сервером",
        });
      }
    });
}

function initHomePage() {
  const homeScriptUrl = new URL("pages/home.js", window.location.href);
  loadScriptOnce(homeScriptUrl.href).then(() => {
    if (window.homePage?.init) {
      window.homePage.init();
    }
  });
}

function setAuthMessage(text, { isError = false } = {}) {
  const messageEl = document.getElementById("auth-message");
  if (!messageEl) return;
  messageEl.innerText = text || "";
  if (isError) {
    messageEl.classList.add("is-error");
  } else {
    messageEl.classList.remove("is-error");
  }
}

function setRegisterMessage(text, { isError = false } = {}) {
  const messageEl = document.getElementById("auth-register-message");
  if (!messageEl) return;
  messageEl.innerText = text || "";
  if (isError) {
    messageEl.classList.add("is-error");
  } else {
    messageEl.classList.remove("is-error");
  }
}

function setAuthTabsActive(targetName) {
  const tabs = Array.from(document.querySelectorAll("[data-auth-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-auth-panel]"));
  const targetTab = tabs.find((tab) => tab.dataset.authTab === targetName);
  if (!targetTab) return;
  tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab === targetTab);
  });
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.authPanel !== targetName;
  });
}

function setAuthState(nextState) {
  authState.isAuthenticated = Boolean(nextState.isAuthenticated);
  authState.email = nextState.email || "";
  authState.username = nextState.username || "";
  authState.userId = nextState.userId ?? null;
  authState.sessionToken = nextState.sessionToken || "";
  subscriptionState.loaded = false;
  subscriptionState.active = false;
  subscriptionState.remainingSeconds = 0;
  subscriptionState.expiresAt = null;
  subscriptionState.label = "";
  updateAuthMenuVisibility();
}

function clearAuthState() {
  authState.isAuthenticated = false;
  authState.email = "";
  authState.username = "";
  authState.userId = null;
  authState.sessionToken = "";
  subscriptionState.loaded = false;
  subscriptionState.active = false;
  subscriptionState.remainingSeconds = 0;
  subscriptionState.expiresAt = null;
  subscriptionState.label = "";
  clearAuthStorage();
  updateAuthMenuVisibility();
}

function updateAuthMenuVisibility() {
  document.querySelectorAll(".auth-only").forEach((item) => {
    item.classList.toggle("is-visible", authState.isAuthenticated);
  });
  document.querySelectorAll(".auth-guest").forEach((item) => {
    item.classList.toggle("is-hidden", authState.isAuthenticated);
  });
}

function saveAuthToStorage() {
  const payload = {
    email: authState.email,
    username: authState.username,
    userId: authState.userId,
    sessionToken: authState.sessionToken,
  };
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
}

function loadAuthFromStorage() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function loadScriptOnce(src) {
  if (pageScripts[src]) return pageScripts[src];
  pageScripts[src] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Не удалось загрузить скрипт ${src}`));
    document.head.appendChild(script);
  });
  return pageScripts[src];
}

function clearAuthStorage() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

async function loginWithEmailPassword(email, password) {
  const res = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email,
      password,
      session_pc: "",
    }),
  });
  return res.json();
}

async function registerAccount({ username, email, password }) {
  const res = await fetch(AUTH_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email,
      password,
    }),
  });
  return res.json();
}

async function refreshSubscriptionState() {
  if (!authState.email || !authState.sessionToken) {
    subscriptionState.loaded = true;
    subscriptionState.active = false;
    subscriptionState.remainingSeconds = 0;
    subscriptionState.expiresAt = null;
    subscriptionState.label = "Не активна";
    return subscriptionState;
  }

  const payload = await fetchSubscriptionStatus();
  subscriptionState.loaded = true;
  subscriptionState.active = Boolean(payload?.active);
  subscriptionState.remainingSeconds = Number(payload?.remaining_seconds) || 0;
  subscriptionState.expiresAt = payload?.expires_at || null;
  subscriptionState.label = buildSubscriptionLabel(payload);
  return subscriptionState;
}

async function fetchSubscriptionStatus() {
  if (!authState.email || !authState.sessionToken) return null;
  const res = await fetch(SUBSCRIPTION_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get_subscription",
      email: authState.email,
      session_pc: authState.sessionToken,
    }),
  });
  return res.json();
}

function formatRemainingTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const totalMinutes = Math.floor(seconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days >= 1) {
    return hours > 0 ? `${days} дн. ${hours} ч.` : `${days} дн.`;
  }
  if (totalHours >= 1) {
    return minutes > 0 ? `${hours} ч. ${minutes} мин.` : `${hours} ч.`;
  }
  if (minutes > 0) return `${minutes} мин.`;
  return "меньше минуты";
}

function buildSubscriptionLabel(payload) {
  if (!payload || payload.status !== "success") return "Нет данных";
  if (!payload.active) return "Не активна";
  const remaining = formatRemainingTime(payload.remaining_seconds);
  return remaining ? `Активна · осталось ${remaining}` : "Активна";
}

async function validateSession(email, sessionToken) {
  const res = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "validate_session",
      email,
      session_pc: sessionToken,
    }),
  });
  return res.json();
}

async function tryRestoreSession() {
  const stored = loadAuthFromStorage();
  if (!stored?.email || !stored?.sessionToken) {
    clearAuthStorage();
    return false;
  }
  try {
    const validation = await validateSession(stored.email, stored.sessionToken);
    if (validation?.status === "success") {
      setAuthState({
        isAuthenticated: true,
        email: stored.email,
        username: stored.username || "",
        userId: stored.userId ?? null,
        sessionToken: stored.sessionToken,
      });
      return true;
    }
  } catch (error) {
    return false;
  }
  clearAuthState();
  return false;
}

function canAccessPage(name) {
  if (name === "profile" && !authState.isAuthenticated) return false;
  return true;
}

function loadPage(name) {
  const container = document.getElementById("page-container");
  if (!container) return;

  if (!canAccessPage(name)) {
    pendingAuthMessage = "Нужно войти в аккаунт, чтобы открыть профиль.";
    loadPage("auth");
    return;
  }

  const url = new URL(`pages/${name}.html`, window.location.href);

  fetch(url)
    .then((res) => res.text())
    .then((html) => {
      container.innerHTML = html;
      setupPage(name);
    })
    .catch((err) => console.error("Ошибка загрузки страницы:", err));
}

window.addEventListener("DOMContentLoaded", async () => {
  const mainEl = document.getElementById("main");

  document.querySelectorAll(".menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      const { page } = item.dataset;
      if (page) {
        loadPage(page);
      }
    });
  });

  document.addEventListener("mousemove", (e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 3;
    const y = (e.clientY / window.innerHeight - 0.5) * 3;

    mainEl.style.transform = `translate(${x}px, ${y}px)`;
  });

  document.addEventListener("click", (event) => {
    const windowBtn = event.target.closest("[data-window-action]");
    if (windowBtn && window.electronAPI?.windowControls) {
      const action = windowBtn.dataset.windowAction;
      if (action === "minimize") window.electronAPI.windowControls.minimize();
      if (action === "toggle-maximize") window.electronAPI.windowControls.toggleMaximize();
      if (action === "close") window.electronAPI.windowControls.close();
      return;
    }

    const moduleLaunchBtn = event.target.closest("[data-module-launch]");
    if (moduleLaunchBtn) {
      const moduleId = moduleLaunchBtn.dataset.moduleLaunch;
      if (moduleId && window.api?.invoke) {
        window.api.invoke("modules:launch", moduleId);
      }
      return;
    }

    const card = event.target.closest(".game-card");
    if (card?.dataset?.page) {
      const page = card.dataset.page.replace(".html", "");
      loadPage(page);
      return;
    }

    const nav = event.target.closest("[data-load-page]");
    if (nav) {
      loadPage(nav.dataset.loadPage);
      return;
    }

    soundSenseUI.handleGlobalClick(event);
  });

  window.electronAPI.updateProgress((percent, text) => {
    progressState.percent = percent;
    progressState.text = text;
    applyProgressState();
  });

  window.electronAPI.onLauncherUpdate((data) => {
    launcherUpdateData = data;
    applyLauncherUpdateState();
  });

  updateAuthMenuVisibility();
  const restored = await tryRestoreSession();
  loadPage(restored ? "home" : "auth");
});
