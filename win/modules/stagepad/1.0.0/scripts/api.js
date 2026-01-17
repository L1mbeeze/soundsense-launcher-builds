import { dom } from "./dom.js";

export function ensureApi() {
  if (window.stagepadAPI) return true;
  if (dom.modalError) {
    dom.modalError.textContent = "API модуля недоступен. Проверьте preload.";
  }
  return false;
}
