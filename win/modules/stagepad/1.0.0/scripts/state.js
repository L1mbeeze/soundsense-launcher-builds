export const DEFAULT_ROWS = 4;
export const DEFAULT_COLS = 3;
const MIXER_KEY = "stagepadMixerGroups";
const DEFAULT_MIXER_GROUPS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

const loadMixerGroups = () => {
  try {
    const raw = localStorage.getItem(MIXER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === DEFAULT_MIXER_GROUPS.length) {
      return parsed.map((val, idx) => (isFinite(val) ? Math.max(0, Math.min(1, Number(val))) : DEFAULT_MIXER_GROUPS[idx]));
    }
  } catch (error) {
    /* ignore */
  }
  return [...DEFAULT_MIXER_GROUPS];
};

export const state = {
  projects: [],
  editingId: null,
  deletingId: null,
  projectGroupFilter: "",
  projectSearchQuery: "",
  currentProject: null,
  scene: { buttons: [] },
  selectedButtonId: null,
  draggingButtonId: null,
  draggingCopy: false,
  draggingTrackId: null,
  gridRows: DEFAULT_ROWS,
  gridCols: DEFAULT_COLS,
  copiedColor: null,
  perfDefaultListMode: localStorage.getItem("stagepadPerfDefaultView") === "list",
  perfListMode: localStorage.getItem("stagepadPerfDefaultView") === "list",
  isPerformance: false,
  perfClickMiddleAction: "restart",
  perfClickRightAction: "open-playlist",
  waveAudioCtx: null,
  currentWaveTrackId: null,
  waveDuration: 0,
  waveSelectionMode: null,
  waveLastTime: null,
  wavePreviewAudio: null,
  wavePreviewFile: null,
  waveEdgeOffset: 0,
  waveMarkerTime: null,
  waveMarkerRaf: null,
  wavePreviewTrackId: null,
  waveStartMarker: null,
  waveZoom: 1,
  wavePan: 0,
  waveIsPanning: false,
  wavePanStart: 0,
  waveMouseDown: false,
  waveBuffers: new Map(),
  reverseCache: new Map(),
  audioOutputEditor: localStorage.getItem("stagepadAudioOutputEditor") || "",
  audioOutputPerformance: localStorage.getItem("stagepadAudioOutputPerformance") || "",
  sceneDirty: false,
  players: new Map(),
  trackPreviews: new Map(), // trackId -> Audio
  playlistState: new Map(),
  preloadCache: new Map(), // trackId -> { url, keep }
  preloadPromises: new Map(), // trackId -> promise<string url>
  preloadEnabled: localStorage.getItem("stagepadPreloadEnabled") === "1",
  perfFontSize: 18,
  perfAlwaysOnTop: localStorage.getItem("stagepadPerfAlwaysOnTop") === "1",
  perfUndoHotkey: localStorage.getItem("stagepadUndoHotkey") || "Ctrl+Alt+Z",
  normalizationEnabled: localStorage.getItem("stagepadNormalizationEnabled") !== "0",
  mixerGroups: loadMixerGroups(),
  playlistPickerButtonId: null,
  lastMusicUndo: null,
  urlParams: new URLSearchParams(window.location.search),
  startupHandled: false,
};

export const startupProjectId = state.urlParams.get("project");
export const startupPerformance = state.urlParams.get("mode") === "performance";
