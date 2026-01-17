import { initApp } from "./main.js";
import { startupProjectId } from "./state.js";

initApp({
  page: "editor",
  projectId: startupProjectId,
  forceEditor: true,
});
