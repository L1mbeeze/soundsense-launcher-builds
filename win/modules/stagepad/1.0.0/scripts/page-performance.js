import "./performance-helpers.js";
import { initApp } from "./main.js";
import { startupProjectId } from "./state.js";

function initPerformancePage() {
  initApp({
    page: "performance",
    projectId: startupProjectId,
    forcePerformance: true,
  });
}

initPerformancePage();
