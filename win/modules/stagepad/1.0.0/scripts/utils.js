import { state } from "./state.js";
import { dom } from "./dom.js";

export const baseName = (str) => (str || "").split(/[\\/]/).pop();

export const formatTime = (seconds) => {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
};

export const computeListMode = () => state.isPerformance && state.perfListMode;
export const isListMode = () => document.body.classList.contains("perf-list-mode");

export const resetEmptyDisplay = () => {
  dom.stageGrid?.querySelectorAll(".stage-cell__empty").forEach((el) => el.style.removeProperty("display"));
};
