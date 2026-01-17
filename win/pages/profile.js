(() => {
  let subscriptionEl = null;

  function getInitials(name) {
    if (!name) return "SS";
    const trimmed = name.trim();
    if (!trimmed) return "SS";
    return trimmed.slice(0, 2).toUpperCase();
  }

  function setSubscriptionText(text) {
    if (!subscriptionEl) return;
    subscriptionEl.innerText = text || "Не активна";
  }

  function init(auth) {
    const titleEl = document.getElementById("profile-title");
    const emailEl = document.getElementById("profile-email");
    subscriptionEl = document.getElementById("profile-subscription");
    const avatarEl = document.getElementById("profile-avatar");
    const statusTextEl = document.getElementById("profile-status-text");
    const statusEditBtn = document.getElementById("profile-status-edit");

    const username = auth?.username || "";
    if (titleEl) titleEl.innerText = username || "Профиль";
    if (emailEl) emailEl.innerText = auth?.email || "—";
    setSubscriptionText(auth?.subscriptionText || "Не активна");
    if (avatarEl) avatarEl.innerText = getInitials(username);

    if (statusTextEl && statusEditBtn) {
      statusEditBtn.addEventListener("click", () => {
        statusTextEl.contentEditable = "true";
        statusTextEl.classList.add("is-editing");
        statusTextEl.focus();
        const range = document.createRange();
        range.selectNodeContents(statusTextEl);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });

      statusTextEl.addEventListener("blur", () => {
        statusTextEl.contentEditable = "false";
        statusTextEl.classList.remove("is-editing");
      });

      statusTextEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          statusTextEl.blur();
        }
      });
    }
  }

  window.profilePage = { init, setSubscriptionText };
})();
