(() => {
  function setMediaFromThumb(thumb) {
    const image = document.getElementById("stagepad-media-image");
    const badge = document.getElementById("stagepad-media-badge");
    if (!thumb || !image) return;

    const src = thumb.dataset.src;
    const type = thumb.dataset.type;
    const title = thumb.dataset.title || "StagePad preview";

    image.src = src;
    image.alt = title;
    if (badge) badge.innerText = type === "video" ? "Видео" : "Фото";
  }

  function initMediaSwitcher() {
    const thumbs = Array.from(document.querySelectorAll(".stagepad-thumb"));
    if (thumbs.length === 0) return;
    thumbs.forEach((thumb) => {
      thumb.addEventListener("click", () => {
        thumbs.forEach((item) => item.classList.remove("is-active"));
        thumb.classList.add("is-active");
        setMediaFromThumb(thumb);
      });
    });
    const initial = thumbs.find((thumb) => thumb.classList.contains("is-active")) || thumbs[0];
    setMediaFromThumb(initial);
  }

  function setSubscriptionState(subscription) {
    const launchBtn = document.getElementById("stagepad-launch-btn");
    const note = document.getElementById("stagepad-subscription-note");
    if (!launchBtn || !note) return;

    const active = Boolean(subscription?.active);
    const label = subscription?.label || "";
    launchBtn.disabled = !active;
    launchBtn.classList.toggle("is-disabled", !active);
    if (active) {
      note.innerText = label || "Подписка активна";
    } else {
      note.innerText = label && label.startsWith("Нет")
        ? label
        : "Оформи подписку, чтобы запустить StagePad.";
    }
  }

  function init({ subscription } = {}) {
    initMediaSwitcher();
    setSubscriptionState(subscription);
  }

  window.stagepadPage = { init, setSubscriptionState };
})();
