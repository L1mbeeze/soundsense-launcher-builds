const bindWindowControls = () => {
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
};

const bindDevtoolsHotkey = () => {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "F12") return;
    event.preventDefault();
    const controls = window.stagepadAPI?.windowControls || window.stagepadWindow?.windowControls;
    controls?.toggleDevTools?.();
  });
};

const setProjectInfo = async () => {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project") || "";
  currentProjectId = projectId;
  const nameEl = document.getElementById("logoProjectName");
  const idEl = document.getElementById("logoProjectId");
  if (idEl) idEl.textContent = projectId || "—";
  if (!nameEl) return;
  if (!projectId) {
    nameEl.textContent = "Проект не выбран";
    return;
  }
  nameEl.textContent = `Проект: ${projectId}`;
  try {
    const meta = await window.stagepadAPI?.getProjectMeta?.(projectId);
    if (meta?.name) {
      nameEl.textContent = meta.name;
    }
    if (meta?.logoDesign && window.stagepadAPI?.getAssetFileUrl) {
      await loadLogoDesign(projectId, meta.logoDesign);
    }
  } catch (error) {
    // Ignore metadata errors for now.
  }
};

const bindBackButton = () => {
  const btn = document.getElementById("btnBack");
  btn?.addEventListener("click", () => {
    window.location.href = "projects.html";
  });
};

const layers = [];
const guides = [];
let selectedLayerId = null;
let draggingLayerId = null;
let dragStart = { x: 0, y: 0 };
let editingLayerId = null;
let layerCounter = 0;
let guideCounter = 0;
let draggingGuideId = null;
let draggingGuideMirror = false;
let currentProjectId = "";

const SNAP_CENTER_PX = 2;
const SNAP_GUIDE_PX = 4;
const SNAP_SOFT_FACTOR = 0.5;
const MAX_SCALE = 2;
const DEFAULT_TEXT = {
  text: "Текст",
  fontFamily: "Segoe UI",
  fontSize: 72,
  color: "#ffffff",
  strokeColor: "#000000",
  strokeWidth: 0,
  italic: false,
  curve: 0,
  effect: "none",
};
const DEFAULT_EFFECTS = {
  "shadow-dance": { speed: 2, colorA: "#ff005e", colorB: "#00d4ff" },
  melting: { speed: 3, colorA: "#ff6f61", colorB: "#ffbd44" },
  matrix: { speed: 2, colorA: "#00ff66", colorB: "#00ff66", rainOpacity: 0.2, rainSpeed: 10 },
  masked: { speed: 5, colorA: "#ff6f61", colorB: "#ffbd44" },
  "spin-3d": { speed: 4, colorA: "#e63946", colorB: "#457b9d" },
  neon: { speed: 1.5, colorA: "#ff005e", colorB: "#00d4ff" },
  "shadow-follow": { speed: 1.5, colorA: "#e30613", colorB: "#009fe3", colorC: "#ffed00" },
};
const customFonts = new Map();

const getLayerById = (id) => layers.find((layer) => layer.id === id);

const COVER_FORMAT_KEY = "stagepadCoverFormat";
const COVER_FORMATS = {
  "16:9": "16 / 9",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
  "9:16": "9 / 16",
};

const applyCoverFormat = (value) => {
  const resolved = COVER_FORMATS[value] || COVER_FORMATS["16:9"];
  document.documentElement.style.setProperty("--stagepad-cover-aspect", resolved);
};

const getCoverRatio = () => {
  const value = localStorage.getItem(COVER_FORMAT_KEY);
  const css = COVER_FORMATS[value] || COVER_FORMATS["16:9"];
  const parts = css.split("/").map((part) => Number(part.trim()));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[1] !== 0) {
    return parts[0] / parts[1];
  }
  return 16 / 9;
};

const applyWorkspaceSize = () => {
  const workspace = document.getElementById("logoWorkspace");
  if (!workspace) return;
  const parent = workspace.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const ratio = getCoverRatio();
  const maxWidth = rect.width || 1;
  const maxHeight = rect.height || 1;
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  workspace.style.width = `${Math.round(width)}px`;
  workspace.style.height = `${Math.round(height)}px`;
};

const initCoverFormat = async () => {
  let format = localStorage.getItem(COVER_FORMAT_KEY);
  if (!format && window.stagepadAPI?.getDisplayPreferences) {
    try {
      const prefs = await window.stagepadAPI.getDisplayPreferences();
      format = prefs?.coverFormat || null;
      if (format) {
        localStorage.setItem(COVER_FORMAT_KEY, format);
      }
    } catch (_) {
      /* ignore */
    }
  }
  applyCoverFormat(format);
  applyWorkspaceSize();
  renderAll();
};

const registerCustomFont = async ({ family, assetPath, url }) => {
  if (!family) return;
  const key = family.toLowerCase();
  if (customFonts.has(key)) {
    const existing = customFonts.get(key);
    if (assetPath && !existing.assetPath) {
      existing.assetPath = assetPath;
    }
    return;
  }
  if (!url) return;
  const style = document.createElement("style");
  style.dataset.fontFamily = family;
  style.textContent = `
    @font-face {
      font-family: "${family}";
      src: url("${url}");
      font-weight: normal;
      font-style: normal;
    }
  `;
  document.head.append(style);
  customFonts.set(key, { url, style, assetPath: assetPath || "", family });
  try {
    await document.fonts.load(`1em "${family}"`);
  } catch (_) {
    /* ignore */
  }
};

const hexToRgba = (hex, alpha = 1) => {
  const safe = (hex || "").trim().replace("#", "");
  const value = safe.length === 3 ? safe.split("").map((c) => c + c).join("") : safe;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return `rgba(0,255,0,${alpha})`;
  const int = parseInt(value, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getEffectSettings = (layer) => {
  const base = DEFAULT_EFFECTS[layer.effect] || { speed: 2, colorA: "#00ff66", colorB: "#00d4ff" };
  const settings = { ...base, ...(layer.effectSettings || {}) };
  if (layer.effect === "matrix" && !settings.rainSpeed) {
    settings.rainSpeed = Math.max(4, (settings.speed || 2) * 5);
  }
  return settings;
};

const getWorkspaceRect = () => {
  const workspace = document.getElementById("logoWorkspace");
  if (!workspace) return null;
  applyWorkspaceSize();
  return workspace.getBoundingClientRect();
};

const updateWorkspaceState = () => {
  const workspace = document.getElementById("logoWorkspace");
  if (!workspace) return;
  workspace.dataset.hasImage = layers.length ? "true" : "false";
};

const getTextMetrics = (layer) => {
  const text = layer.text ?? DEFAULT_TEXT.text;
  const size = Number(layer.fontSize || DEFAULT_TEXT.fontSize);
  const family = layer.fontFamily || DEFAULT_TEXT.fontFamily;
  const italic = layer.italic ? "italic " : "";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { width: size * text.length * 0.6, height: size * 1.2 };
  }
  ctx.font = `${italic}${size}px ${family}`;
  const width = ctx.measureText(text).width;
  const curveBoost = Math.abs(layer.curve || 0) * 0.6;
  return { width: Math.max(1, width), height: Math.max(1, size * 1.2 + curveBoost) };
};

const getBaseSize = (layer, img, rect) => {
  if (layer.type === "text") {
    if (layer.size?.width || layer.size?.height) {
      const width = layer.size?.width;
      const height = layer.size?.height;
      const metrics = getTextMetrics(layer);
      if (width && height) return { width, height };
      if (width) return { width, height: width * (metrics.height / metrics.width) };
      if (height) return { width: height * (metrics.width / metrics.height), height };
    }
    return getTextMetrics(layer);
  }
  const naturalW = img.naturalWidth || img.width || 0;
  const naturalH = img.naturalHeight || img.height || 0;
  if (!naturalW || !naturalH) {
    return null;
  }
  const aspect = naturalH / naturalW;
  if (layer.size?.width || layer.size?.height) {
    const width = layer.size?.width;
    const height = layer.size?.height;
    if (width && height) {
      return { width, height };
    }
    if (width) {
      return { width, height: width * aspect };
    }
    if (height) {
      return { width: height / aspect, height };
    }
  }
  if (!rect) {
    return null;
  }
  const baseScale = Math.min(1, rect.width / naturalW, rect.height / naturalH);
  return { width: naturalW * baseScale, height: naturalH * baseScale };
};

const updateLayerTransform = (img, layer, rect) => {
  const scale = layer.scale ?? 1;
  const x = layer.offset?.x ?? 0;
  const y = layer.offset?.y ?? 0;
  const base = getBaseSize(layer, img, rect);
  if (base) {
    img.style.width = `${base.width}px`;
    img.style.height = `${base.height}px`;
  } else {
    img.style.removeProperty("width");
    img.style.removeProperty("height");
  }
  img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
};

const getGuidePositions = (orientation, rect) => {
  const positions = [];
  guides.forEach((guide) => {
    if (orientation === "vertical" && guide.orientation !== "vertical") return;
    if (orientation === "horizontal" && guide.orientation !== "horizontal") return;
    const primary = guide.offset;
    const mirror = orientation === "vertical" ? rect.width - guide.offset : rect.height - guide.offset;
    positions.push(primary, mirror);
  });
  return positions;
};

const applySnap = (layer, img, rect, nextOffset) => {
  const base = getBaseSize(layer, img, rect);
  if (!base) return;
  const imgW = base.width * (layer.scale ?? 1);
  const imgH = base.height * (layer.scale ?? 1);
  const centerX = rect.width / 2 + nextOffset.x;
  const centerY = rect.height / 2 + nextOffset.y;

  if (Math.abs(nextOffset.x) <= SNAP_CENTER_PX) {
    nextOffset.x *= 1 - SNAP_SOFT_FACTOR;
  }
  if (Math.abs(nextOffset.y) <= SNAP_CENTER_PX) {
    nextOffset.y *= 1 - SNAP_SOFT_FACTOR;
  }

  const vGuides = getGuidePositions("vertical", rect);
  const hGuides = getGuidePositions("horizontal", rect);

  let bestDx = null;
  vGuides.forEach((gx) => {
    const snapCenter = gx - centerX;
    const left = centerX - imgW / 2;
    const right = centerX + imgW / 2;
    const snapLeft = gx - left;
    const snapRight = gx - right;
    if (Math.abs(snapCenter) <= SNAP_GUIDE_PX) {
      if (bestDx == null || Math.abs(snapCenter) < Math.abs(bestDx)) bestDx = snapCenter;
    }
    if (Math.abs(snapLeft) <= SNAP_GUIDE_PX) {
      if (bestDx == null || Math.abs(snapLeft) < Math.abs(bestDx)) bestDx = snapLeft;
    }
    if (Math.abs(snapRight) <= SNAP_GUIDE_PX) {
      if (bestDx == null || Math.abs(snapRight) < Math.abs(bestDx)) bestDx = snapRight;
    }
  });
  if (bestDx != null) {
    nextOffset.x += bestDx * SNAP_SOFT_FACTOR;
  }

  let bestDy = null;
  hGuides.forEach((gy) => {
    const snapCenter = gy - centerY;
    const top = centerY - imgH / 2;
    const bottom = centerY + imgH / 2;
    const snapTop = gy - top;
    const snapBottom = gy - bottom;
    if (Math.abs(snapCenter) <= SNAP_GUIDE_PX) {
      if (bestDy == null || Math.abs(snapCenter) < Math.abs(bestDy)) bestDy = snapCenter;
    }
    if (Math.abs(snapTop) <= SNAP_GUIDE_PX) {
      if (bestDy == null || Math.abs(snapTop) < Math.abs(bestDy)) bestDy = snapTop;
    }
    if (Math.abs(snapBottom) <= SNAP_GUIDE_PX) {
      if (bestDy == null || Math.abs(snapBottom) < Math.abs(bestDy)) bestDy = snapBottom;
    }
  });
  if (bestDy != null) {
    nextOffset.y += bestDy * SNAP_SOFT_FACTOR;
  }
};

const renderWorkspace = () => {
  const container = document.getElementById("logoLayers");
  const rect = getWorkspaceRect();
  if (!container) return;
  container.innerHTML = "";
  layers.forEach((layer, idx) => {
    let element = null;
    if (layer.type === "text") {
      const wrap = document.createElement("div");
      wrap.className = "logo-layer-text";
      wrap.dataset.layerId = layer.id;
      wrap.style.zIndex = String(idx + 1);
      wrap.draggable = false;
      const metrics = getTextMetrics(layer);
      const width = metrics.width;
      const height = metrics.height;
      const textValue = layer.text ?? DEFAULT_TEXT.text;
      const effect = layer.effect || DEFAULT_TEXT.effect;
      const effectSettings = getEffectSettings(layer);
      const curve = Number(layer.curve || 0);
      if (effect === "shadow-dance" && curve === 0) {
        const span = document.createElement("span");
        span.className = "text-effect-shadow-dance";
        span.textContent = textValue;
        span.style.setProperty("--shadow-a", effectSettings.colorA);
        span.style.setProperty("--shadow-b", effectSettings.colorB);
        span.style.setProperty("--effect-speed", `${effectSettings.speed || 2}s`);
        span.style.fontFamily = layer.fontFamily || DEFAULT_TEXT.fontFamily;
        span.style.fontSize = `${layer.fontSize || DEFAULT_TEXT.fontSize}px`;
        span.style.fontStyle = layer.italic ? "italic" : "normal";
        span.style.color = layer.color || DEFAULT_TEXT.color;
        const strokeWidth = Number(layer.strokeWidth || 0);
        if (strokeWidth > 0) {
          span.style.webkitTextStroke = `${strokeWidth}px ${layer.strokeColor || DEFAULT_TEXT.strokeColor}`;
        } else {
          span.style.webkitTextStroke = "0px transparent";
        }
        wrap.append(span);
      } else if (effect === "melting" && curve === 0) {
        const span = document.createElement("span");
        span.className = "text-effect-melting";
        span.textContent = textValue;
        span.dataset.text = textValue;
        span.style.setProperty("--melt-a", effectSettings.colorA);
        span.style.setProperty("--melt-b", effectSettings.colorB);
        span.style.setProperty("--effect-speed", `${effectSettings.speed || 3}s`);
        span.style.fontFamily = layer.fontFamily || DEFAULT_TEXT.fontFamily;
        span.style.fontSize = `${layer.fontSize || DEFAULT_TEXT.fontSize}px`;
        span.style.fontStyle = layer.italic ? "italic" : "normal";
        wrap.append(span);
      } else if (effect === "matrix" && curve === 0) {
        const span = document.createElement("span");
        span.className = "text-effect-matrix";
        span.textContent = textValue;
        span.dataset.text = textValue;
        span.style.setProperty("--matrix-color", effectSettings.colorA);
        span.style.setProperty("--matrix-glow", effectSettings.colorB || effectSettings.colorA);
        span.style.setProperty("--effect-speed", `${effectSettings.speed || 2}s`);
        span.style.setProperty("--rain-speed", `${effectSettings.rainSpeed || 10}s`);
        span.style.fontSize = `${layer.fontSize || DEFAULT_TEXT.fontSize}px`;
        span.style.fontStyle = layer.italic ? "italic" : "normal";
        const rain = document.createElement("span");
        rain.className = "matrix-rain";
        rain.style.setProperty("--matrix-rain", hexToRgba(effectSettings.colorA, effectSettings.rainOpacity ?? 0.2));
        span.append(rain);
        wrap.append(span);
      } else if (effect === "masked" && curve === 0) {
        const span = document.createElement("span");
        span.className = "text-effect-masked";
        span.textContent = textValue;
        span.style.setProperty("--mask-a", effectSettings.colorA);
        span.style.setProperty("--mask-b", effectSettings.colorB);
        span.style.setProperty("--effect-speed", `${effectSettings.speed || 5}s`);
        span.style.fontFamily = layer.fontFamily || DEFAULT_TEXT.fontFamily;
        span.style.fontSize = `${layer.fontSize || DEFAULT_TEXT.fontSize}px`;
        span.style.fontStyle = layer.italic ? "italic" : "normal";
        wrap.append(span);
      } else if (effect === "spin-3d" && curve === 0) {
        const span = document.createElement("span");
        span.className = "text-effect-spin";
        span.textContent = textValue;
        span.style.setProperty("--effect-speed", `${effectSettings.speed || 4}s`);
        span.style.setProperty("--spin-base", layer.color || DEFAULT_TEXT.color);
        span.style.setProperty("--spin-1", effectSettings.colorA || "#e63946");
        span.style.setProperty("--spin-2", effectSettings.colorB || "#f77f00");
        span.style.setProperty("--spin-3", effectSettings.colorA || "#fcbf49");
        span.style.setProperty("--spin-4", effectSettings.colorB || "#a8dadc");
        span.style.setProperty("--spin-5", effectSettings.colorA || "#457b9d");
        span.style.fontFamily = layer.fontFamily || DEFAULT_TEXT.fontFamily;
        span.style.fontSize = `${layer.fontSize || DEFAULT_TEXT.fontSize}px`;
        span.style.fontStyle = layer.italic ? "italic" : "normal";
        const strokeWidth = Number(layer.strokeWidth || 0);
        if (strokeWidth > 0) {
          span.style.webkitTextStroke = `${strokeWidth}px ${layer.strokeColor || DEFAULT_TEXT.strokeColor}`;
        } else {
          span.style.webkitTextStroke = "0px transparent";
        }
        wrap.append(span);
      } else if (effect === "neon" && curve === 0) {
        const span = document.createElement("span");
        span.className = "text-effect-neon";
        span.textContent = textValue;
        span.style.setProperty("--neon-base", layer.color || DEFAULT_TEXT.color);
        span.style.setProperty("--neon-a", effectSettings.colorA || "#ff005e");
        span.style.setProperty("--neon-b", effectSettings.colorB || "#00d4ff");
        span.style.setProperty("--effect-speed", `${effectSettings.speed || 1.5}s`);
        span.style.fontFamily = layer.fontFamily || DEFAULT_TEXT.fontFamily;
        span.style.fontSize = `${layer.fontSize || DEFAULT_TEXT.fontSize}px`;
        span.style.fontStyle = layer.italic ? "italic" : "normal";
        const strokeWidth = Number(layer.strokeWidth || 0);
        if (strokeWidth > 0) {
          span.style.webkitTextStroke = `${strokeWidth}px ${layer.strokeColor || DEFAULT_TEXT.strokeColor}`;
        } else {
          span.style.webkitTextStroke = "0px transparent";
        }
        wrap.append(span);
      } else if (effect === "shadow-follow" && curve === 0) {
        const span = document.createElement("span");
        span.className = "text-effect-follow";
        span.textContent = textValue;
        span.style.setProperty("--follow-base", layer.color || DEFAULT_TEXT.color);
        span.style.setProperty("--follow-a", effectSettings.colorA || "#e30613");
        span.style.setProperty("--follow-b", effectSettings.colorB || "#009fe3");
        span.style.setProperty("--follow-c", effectSettings.colorC || "#ffed00");
        span.dataset.followSpeed = String(effectSettings.speed || 1.5);
        span.style.fontFamily = layer.fontFamily || DEFAULT_TEXT.fontFamily;
        span.style.fontSize = `${layer.fontSize || DEFAULT_TEXT.fontSize}px`;
        span.style.fontStyle = layer.italic ? "italic" : "normal";
        const strokeWidth = Number(layer.strokeWidth || 0);
        if (strokeWidth > 0) {
          span.style.webkitTextStroke = `${strokeWidth}px ${layer.strokeColor || DEFAULT_TEXT.strokeColor}`;
        } else {
          span.style.webkitTextStroke = "0px transparent";
        }
        wrap.append(span);
      } else {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const pathId = `text_path_${layer.id}`;
        const midY = height / 2;
        const controlY = midY - curve;
        path.setAttribute("id", pathId);
        path.setAttribute("d", `M 0 ${midY} Q ${width / 2} ${controlY} ${width} ${midY}`);
        defs.append(path);
        svg.append(defs);
        const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textEl.setAttribute("text-anchor", "middle");
        textEl.setAttribute("dominant-baseline", "middle");
        textEl.setAttribute("fill", layer.color || DEFAULT_TEXT.color);
        const strokeWidth = Number(layer.strokeWidth || 0);
        if (strokeWidth > 0) {
          textEl.setAttribute("stroke", layer.strokeColor || DEFAULT_TEXT.strokeColor);
          textEl.setAttribute("stroke-width", String(strokeWidth));
          textEl.setAttribute("paint-order", "stroke");
          textEl.setAttribute("stroke-linejoin", "round");
        }
        textEl.setAttribute("font-family", layer.fontFamily || DEFAULT_TEXT.fontFamily);
        textEl.setAttribute("font-size", String(layer.fontSize || DEFAULT_TEXT.fontSize));
        textEl.setAttribute("font-style", layer.italic ? "italic" : "normal");
        if (curve !== 0) {
          const textPath = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
          textPath.setAttribute("href", `#${pathId}`);
          textPath.setAttribute("startOffset", "50%");
          textPath.setAttribute("text-anchor", "middle");
          textPath.textContent = textValue;
          textEl.append(textPath);
        } else {
          textEl.setAttribute("x", String(width / 2));
          textEl.setAttribute("y", String(midY));
          textEl.textContent = textValue;
        }
        svg.append(textEl);
        wrap.append(svg);
      }
      element = wrap;
    } else {
      const img = document.createElement("img");
      img.className = "logo-layer-image";
      img.src = layer.src;
      img.alt = layer.name || "Логотип";
      img.dataset.layerId = layer.id;
      img.draggable = false;
      img.style.zIndex = String(idx + 1);
      img.addEventListener("load", () => {
        updateLayerTransform(img, layer, getWorkspaceRect());
        updateSizeUI();
      });
      element = img;
    }
    if (!element) return;
    updateLayerTransform(element, layer, rect);
    if (layer.id === selectedLayerId) {
      element.classList.add("is-selected");
    }
    container.append(element);
  });
  updateWorkspaceState();
  updateFollowShadows();
};

let followPointer = null;
let followRaf = null;

const updateFollowShadows = () => {
  const elements = document.querySelectorAll(".text-effect-follow");
  if (!elements.length) return;
  if (!followPointer) {
    elements.forEach((el) => {
      el.style.setProperty("--follow-x1", "0px");
      el.style.setProperty("--follow-y1", "0px");
      el.style.setProperty("--follow-x2", "0px");
      el.style.setProperty("--follow-y2", "0px");
      el.style.setProperty("--follow-x3", "0px");
      el.style.setProperty("--follow-y3", "0px");
    });
    return;
  }
  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = followPointer.x - centerX;
    const dy = followPointer.y - centerY;
    const speed = Math.max(0.2, Number(el.dataset.followSpeed || 1));
    el.style.setProperty("--follow-x1", `${(dx / 80) * speed}px`);
    el.style.setProperty("--follow-y1", `${(dy / 10) * speed}px`);
    el.style.setProperty("--follow-x2", `${(dx / 60) * speed}px`);
    el.style.setProperty("--follow-y2", `${(dy / 8) * speed}px`);
    el.style.setProperty("--follow-x3", `${(dx / 70) * speed}px`);
    el.style.setProperty("--follow-y3", `${(dy / 12) * speed}px`);
  });
};

const scheduleFollowUpdate = () => {
  if (followRaf) return;
  followRaf = requestAnimationFrame(() => {
    followRaf = null;
    updateFollowShadows();
  });
};

const renderGuides = () => {
  const container = document.getElementById("logoGuides");
  const rect = getWorkspaceRect();
  if (!container || !rect) return;
  container.innerHTML = "";
  guides.forEach((guide) => {
    const isVertical = guide.orientation === "vertical";
    const primary = document.createElement("div");
    primary.className = `logo-guide ${isVertical ? "logo-guide--v" : "logo-guide--h"}`;
    primary.dataset.guideId = guide.id;
    primary.dataset.guideMirror = "false";
    if (isVertical) {
      primary.style.left = `${guide.offset}px`;
    } else {
      primary.style.top = `${guide.offset}px`;
    }
    container.append(primary);

    const mirror = document.createElement("div");
    mirror.className = `logo-guide ${isVertical ? "logo-guide--v" : "logo-guide--h"}`;
    mirror.dataset.guideId = guide.id;
    mirror.dataset.guideMirror = "true";
    if (isVertical) {
      mirror.style.left = `${rect.width - guide.offset}px`;
    } else {
      mirror.style.top = `${rect.height - guide.offset}px`;
    }
    container.append(mirror);
  });
};

const renderLayerList = () => {
  const list = document.getElementById("logoLayerList");
  if (!list) return;
  if (!layers.length) {
    list.innerHTML = `<div class="hint">Список пуст. Добавьте изображения.</div>`;
    return;
  }
  list.innerHTML = layers
    .map(
      (layer) => `
        <div class="logo-layer-item ${layer.id === selectedLayerId ? "is-selected" : ""}" draggable="true" data-layer-id="${layer.id}">
          <div class="logo-layer-info">
            ${
              layer.id === editingLayerId
                ? `<input class="logo-layer-name-input" data-layer-name-input="${layer.id}" value="${layer.name || ""}" maxlength="60">`
                : `<div class="logo-layer-title" data-layer-name="${layer.id}" title="${layer.name || ""}">${layer.name || "Без имени"}</div>`
            }
            <div class="logo-layer-file" title="${layer.fileName || ""}">${layer.fileName || "Файл не выбран"}</div>
          </div>
          <div class="logo-layer-actions">
            <button class="btn ghost small" data-layer-edit="${layer.id}">Редактировать</button>
            <button class="btn danger small" data-layer-delete="${layer.id}">Удалить</button>
          </div>
        </div>
      `
    )
    .join("");

  if (editingLayerId) {
    const input = list.querySelector(`[data-layer-name-input="${editingLayerId}"]`);
    if (input) {
      requestAnimationFrame(() => {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      });
    }
  }
};

const renderAll = () => {
  renderWorkspace();
  renderGuides();
  renderLayerList();
  updateScaleUI();
  updateSizeUI();
  updateTextSettingsUI();
  updateSaveState();
};

const updateScaleUI = () => {
  const input = document.getElementById("logoScale");
  const value = document.getElementById("logoScaleValue");
  const layer = getLayerById(selectedLayerId);
  if (!input || !value) return;
  if (!layer) {
    input.value = "100";
    input.disabled = true;
    value.textContent = "100%";
    return;
  }
  const scale = Math.round((layer.scale ?? 1) * 100);
  input.value = String(scale);
  input.disabled = false;
  value.textContent = `${scale}%`;
};

const updateSaveState = () => {
  const saveBtn = document.getElementById("logoSave");
  if (!saveBtn) return;
  saveBtn.disabled = !currentProjectId || layers.length === 0;
};

const loadLogoDesign = async (projectId, logoDesign) => {
  if (!projectId || !logoDesign) return;
  try {
    const url = window.stagepadAPI?.getAssetFileUrl?.(projectId, logoDesign);
    if (!url) return;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || !Array.isArray(data.layers)) return;
    if (Array.isArray(data.fonts) && data.fonts.length) {
      for (const font of data.fonts) {
        if (!font?.family || !font?.assetPath) continue;
        const fontUrl = window.stagepadAPI?.getAssetFileUrl?.(projectId, font.assetPath);
        if (!fontUrl) continue;
        await registerCustomFont({ family: font.family, url: fontUrl, assetPath: font.assetPath });
        const fontSelect = document.getElementById("logoTextFont");
        if (fontSelect) {
          const exists = Array.from(fontSelect.options).some(
            (opt) => opt.value.toLowerCase() === font.family.toLowerCase()
          );
          if (!exists) {
            const option = document.createElement("option");
            option.value = font.family;
            option.textContent = font.family;
            fontSelect.append(option);
          }
        }
      }
    }
    layers.length = 0;
    data.layers.forEach((layer, idx) => {
      const entry = {
        id: layer.id || `layer_${Date.now()}_${idx}`,
        type: layer.type || "image",
        name: layer.name || (layer.type === "text" ? `Текст ${idx + 1}` : `Слой ${idx + 1}`),
        fileName: layer.fileName || (layer.type === "text" ? "Текстовый слой" : "Без имени"),
        assetPath: layer.assetPath || "",
        src: "",
        offset: layer.offset || { x: 0, y: 0 },
        scale: typeof layer.scale === "number" ? layer.scale : 1,
        size: layer.size || null,
        baseSize: layer.baseSize || null,
        text: layer.text || DEFAULT_TEXT.text,
        fontFamily: layer.fontFamily || DEFAULT_TEXT.fontFamily,
        fontSize: layer.fontSize || DEFAULT_TEXT.fontSize,
        color: layer.color || DEFAULT_TEXT.color,
        strokeColor: layer.strokeColor || DEFAULT_TEXT.strokeColor,
        strokeWidth: layer.strokeWidth || DEFAULT_TEXT.strokeWidth,
        effect: layer.effect || DEFAULT_TEXT.effect,
        effectSettings: layer.effectSettings || DEFAULT_EFFECTS[layer.effect] || null,
        italic: Boolean(layer.italic),
        curve: typeof layer.curve === "number" ? layer.curve : DEFAULT_TEXT.curve,
      };
      if (entry.type === "image" && entry.assetPath) {
        entry.src = window.stagepadAPI.getAssetFileUrl(projectId, entry.assetPath);
      }
      layers.push(entry);
    });
    layerCounter = layers.length;
    selectedLayerId = layers[layers.length - 1]?.id || null;
    editingLayerId = null;
    await document.fonts.ready;
    renderAll();
  } catch (error) {
    console.error("Не удалось загрузить дизайн логотипа:", error);
  }
};

const updateTextSettingsUI = () => {
  const panel = document.getElementById("logoTextSettings");
  const layer = getLayerById(selectedLayerId);
  if (!panel) return;
  if (!layer || layer.type !== "text") {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const textInput = document.getElementById("logoTextContent");
  const fontSelect = document.getElementById("logoTextFont");
  const sizeInput = document.getElementById("logoTextSize");
  const colorInput = document.getElementById("logoTextColor");
  const strokeColorInput = document.getElementById("logoTextStrokeColor");
  const strokeWidthInput = document.getElementById("logoTextStrokeWidth");
  const effectSelect = document.getElementById("logoTextEffect");
  const effectSpeed = document.getElementById("logoEffectSpeed");
  const effectSpeedValue = document.getElementById("logoEffectSpeedValue");
  const effectColorA = document.getElementById("logoEffectColorA");
  const effectColorB = document.getElementById("logoEffectColorB");
  const effectRain = document.getElementById("logoEffectRainField");
  const effectRainOpacity = document.getElementById("logoEffectRainOpacity");
  const effectRainValue = document.getElementById("logoEffectRainValue");
  const effectPanel = document.getElementById("logoEffectSection");
  const italicInput = document.getElementById("logoTextItalic");
  const curveInput = document.getElementById("logoTextCurve");
  const curveValue = document.getElementById("logoTextCurveValue");
  const effectToggle = document.getElementById("logoEffectToggle");
  const effectBody = document.getElementById("logoEffectBody");
  if (textInput) textInput.value = layer.text ?? DEFAULT_TEXT.text;
  if (fontSelect) fontSelect.value = layer.fontFamily || DEFAULT_TEXT.fontFamily;
  if (sizeInput) sizeInput.value = String(layer.fontSize || DEFAULT_TEXT.fontSize);
  if (colorInput) colorInput.value = layer.color || DEFAULT_TEXT.color;
  if (strokeColorInput) strokeColorInput.value = layer.strokeColor || DEFAULT_TEXT.strokeColor;
  if (strokeWidthInput) strokeWidthInput.value = String(layer.strokeWidth || 0);
  if (effectSelect) effectSelect.value = layer.effect || DEFAULT_TEXT.effect;
  if (italicInput) italicInput.checked = Boolean(layer.italic);
  if (curveInput) curveInput.value = String(layer.curve || 0);
  if (curveValue) curveValue.textContent = String(layer.curve || 0);
  if (effectPanel) effectPanel.hidden = (layer.effect || "none") === "none";
  if (layer.effect && layer.effect !== "none") {
    const settings = getEffectSettings(layer);
    if (effectSpeed) effectSpeed.value = String(settings.speed || 2);
    if (effectSpeedValue) effectSpeedValue.textContent = `${settings.speed || 2}s`;
    if (effectColorA) effectColorA.value = settings.colorA || "#00ff66";
    if (effectColorB) effectColorB.value = settings.colorB || "#00d4ff";
    if (effectRain) effectRain.hidden = layer.effect !== "matrix";
    if (effectRainOpacity) effectRainOpacity.value = String(settings.rainOpacity ?? 0.2);
    if (effectRainValue) effectRainValue.textContent = String(settings.rainOpacity ?? 0.2);
  } else {
    if (effectRain) effectRain.hidden = true;
  }
};

const updateSizeUI = () => {
  const widthInput = document.getElementById("logoWidth");
  const heightInput = document.getElementById("logoHeight");
  const widthReset = document.getElementById("logoWidthReset");
  const heightReset = document.getElementById("logoHeightReset");
  if (!widthInput || !heightInput) return;
  const layer = getLayerById(selectedLayerId);
  if (!layer) {
    widthInput.value = "";
    heightInput.value = "";
    widthInput.disabled = true;
    heightInput.disabled = true;
    if (widthReset) widthReset.disabled = true;
    if (heightReset) heightReset.disabled = true;
    return;
  }
  const img = document.querySelector(`[data-layer-id="${selectedLayerId}"]`);
  const rect = getWorkspaceRect();
  const base = img && rect ? getBaseSize(layer, img, rect) : null;
  const hasCustom = Boolean(layer.size);
  const width = hasCustom ? layer.size?.width : base?.width;
  const height = hasCustom ? layer.size?.height : base?.height;
  widthInput.value = width ? Math.round(width).toString() : "";
  heightInput.value = height ? Math.round(height).toString() : "";
  widthInput.disabled = false;
  heightInput.disabled = false;
  if (widthReset) widthReset.disabled = false;
  if (heightReset) heightReset.disabled = false;
};

const selectLayer = (id) => {
  selectedLayerId = id;
  renderAll();
};

const addLayerFromFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      layerCounter += 1;
      resolve({
        id: `layer_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: `Слой ${layerCounter}`,
        fileName: file.name || "Без имени",
        type: "image",
        src: reader.result,
        offset: { x: 0, y: 0 },
        scale: 1,
      });
    };
    reader.readAsDataURL(file);
  });

const handleAddFiles = async (files) => {
  if (!files || !files.length) return;
  const newLayers = [];
  for (const file of files) {
    newLayers.push(await addLayerFromFile(file));
  }
  layers.push(...newLayers);
  if (newLayers.length) {
    const lastAdded = newLayers[newLayers.length - 1].id;
    selectedLayerId = lastAdded;
    editingLayerId = lastAdded;
  } else if (!selectedLayerId && layers.length) {
    selectedLayerId = layers[layers.length - 1].id;
  }
  renderAll();
};

const bindLogoPicker = () => {
  const input = document.getElementById("logoFile");
  const chooseBtn = document.getElementById("logoChoose");
  const addTextBtn = document.getElementById("logoAddText");
  if (!input || !chooseBtn) return;
  input.setAttribute("multiple", "true");
  chooseBtn.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    await handleAddFiles(Array.from(input.files || []));
    input.value = "";
  });
  addTextBtn?.addEventListener("click", () => addTextLayer());
};

const bindLogoReplace = () => {
  const replaceInput = document.getElementById("logoReplaceInput");
  if (!replaceInput) return;
  replaceInput.addEventListener("change", async () => {
    const layer = getLayerById(selectedLayerId);
    const file = replaceInput.files?.[0];
    if (!layer || !file) return;
    const updated = await addLayerFromFile(file);
    layer.type = "image";
    layer.src = updated.src;
    layer.fileName = updated.fileName;
    renderAll();
    replaceInput.value = "";
  });
};

const addTextLayer = () => {
  layerCounter += 1;
  const id = `layer_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  layers.push({
    id,
    name: `Текст ${layerCounter}`,
    fileName: "Текстовый слой",
    type: "text",
    text: DEFAULT_TEXT.text,
    fontFamily: DEFAULT_TEXT.fontFamily,
    fontSize: DEFAULT_TEXT.fontSize,
    color: DEFAULT_TEXT.color,
    strokeColor: DEFAULT_TEXT.strokeColor,
    strokeWidth: DEFAULT_TEXT.strokeWidth,
    italic: DEFAULT_TEXT.italic,
    curve: DEFAULT_TEXT.curve,
    effect: DEFAULT_TEXT.effect,
    effectSettings: { ...DEFAULT_EFFECTS[DEFAULT_TEXT.effect] },
    offset: { x: 0, y: 0 },
    scale: 1,
  });
  selectedLayerId = id;
  editingLayerId = id;
  renderAll();
};

const commitLayerName = (input) => {
  const id = input.dataset.layerNameInput;
  const layer = getLayerById(id);
  if (!layer) return;
  const next = input.value.trim() || layer.name || `Слой ${layerCounter}`;
  layer.name = next;
  editingLayerId = null;
  renderLayerList();
};

const bindLayerListActions = () => {
  const list = document.getElementById("logoLayerList");
  const replaceInput = document.getElementById("logoReplaceInput");
  if (!list || !replaceInput) return;

  list.addEventListener("click", (event) => {
    const nameEl = event.target.closest("[data-layer-name]");
    const editBtn = event.target.closest("[data-layer-edit]");
    const deleteBtn = event.target.closest("[data-layer-delete]");
    const item = event.target.closest("[data-layer-id]");
    if (nameEl) {
      selectLayer(nameEl.dataset.layerName);
      return;
    }
    if (editBtn) {
      const id = editBtn.dataset.layerEdit;
      const layer = getLayerById(id);
      selectLayer(id);
      if (layer?.type === "text") {
        updateTextSettingsUI();
      } else {
        replaceInput.click();
      }
      return;
    }
    if (deleteBtn) {
      const id = deleteBtn.dataset.layerDelete;
      const idx = layers.findIndex((layer) => layer.id === id);
      if (idx !== -1) layers.splice(idx, 1);
      if (selectedLayerId === id) {
        selectedLayerId = layers[layers.length - 1]?.id || null;
      }
      renderAll();
      return;
    }
    if (item) {
      selectLayer(item.dataset.layerId);
    }
  });

  list.addEventListener("dblclick", (event) => {
    const nameEl = event.target.closest("[data-layer-name]");
    if (!nameEl) return;
    editingLayerId = nameEl.dataset.layerName;
    renderLayerList();
  });

  list.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-layer-name-input]");
    if (!input) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitLayerName(input);
    }
  });

  list.addEventListener("focusout", (event) => {
    const input = event.target.closest("[data-layer-name-input]");
    if (!input) return;
    commitLayerName(input);
  });
};

const bindLayerReorder = () => {
  const list = document.getElementById("logoLayerList");
  if (!list) return;

  list.addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-layer-id]");
    if (!item) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.dataset.layerId);
    item.classList.add("is-dragging");
  });

  list.addEventListener("dragend", (event) => {
    const item = event.target.closest("[data-layer-id]");
    item?.classList.remove("is-dragging");
  });

  list.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  list.addEventListener("drop", (event) => {
    event.preventDefault();
    const draggedId = event.dataTransfer?.getData("text/plain");
    const target = event.target.closest("[data-layer-id]");
    if (!draggedId) return;
    const fromIndex = layers.findIndex((layer) => layer.id === draggedId);
    if (fromIndex === -1) return;
    let toIndex = target ? layers.findIndex((layer) => layer.id === target.dataset.layerId) : layers.length - 1;
    if (toIndex === -1) toIndex = layers.length - 1;
    const [moved] = layers.splice(fromIndex, 1);
    if (fromIndex < toIndex) toIndex -= 1;
    layers.splice(toIndex, 0, moved);
    renderAll();
  });
};

const bindScaleControl = () => {
  const input = document.getElementById("logoScale");
  if (!input) return;
  input.addEventListener("input", () => {
    const layer = getLayerById(selectedLayerId);
    if (!layer) return;
    const scale = Math.max(0.05, Math.min(MAX_SCALE, Number(input.value) / 100));
    layer.scale = scale;
    updateScaleUI();
    renderWorkspace();
  });
};

const bindSizeInputs = () => {
  const widthInput = document.getElementById("logoWidth");
  const heightInput = document.getElementById("logoHeight");
  const widthReset = document.getElementById("logoWidthReset");
  const heightReset = document.getElementById("logoHeightReset");
  if (!widthInput || !heightInput) return;

  const parseDimension = (val) => {
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  const applySize = (key, value) => {
    const layer = getLayerById(selectedLayerId);
    if (!layer) return;
    const num = parseDimension(value);
    if (!num) return;
    const otherInput = key === "width" ? heightInput : widthInput;
    const otherValue = parseDimension(otherInput?.value);
    layer.size = {
      ...(key === "width" ? { width: num } : { height: num }),
      ...(otherValue ? (key === "width" ? { height: otherValue } : { width: otherValue }) : {}),
    };
    renderWorkspace();
    updateSizeUI();
  };

  widthInput.addEventListener("input", () => {
    applySize("width", widthInput.value);
  });

  heightInput.addEventListener("input", () => {
    applySize("height", heightInput.value);
  });

  const bindWheelStep = (inputEl, key) => {
    inputEl.addEventListener("wheel", (event) => {
      const layer = getLayerById(selectedLayerId);
      if (!layer) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dir = event.deltaY < 0 ? 1 : -1;
      const current = parseDimension(inputEl.value) || 0;
      const next = Math.max(1, current + dir * step);
      inputEl.value = String(next);
      applySize(key, inputEl.value);
    }, { passive: false });
  };

  bindWheelStep(widthInput, "width");
  bindWheelStep(heightInput, "height");

  widthReset?.addEventListener("click", () => {
    const layer = getLayerById(selectedLayerId);
    if (!layer) return;
    if (layer.size?.height) {
      layer.size = { height: layer.size.height };
    } else {
      layer.size = null;
    }
    renderWorkspace();
    updateSizeUI();
  });

  heightReset?.addEventListener("click", () => {
    const layer = getLayerById(selectedLayerId);
    if (!layer) return;
    if (layer.size?.width) {
      layer.size = { width: layer.size.width };
    } else {
      layer.size = null;
    }
    renderWorkspace();
    updateSizeUI();
  });
};

const bindTextSettings = () => {
  const textInput = document.getElementById("logoTextContent");
  const fontSelect = document.getElementById("logoTextFont");
  const fontFileInput = document.getElementById("logoTextFontFile");
  const fontAddBtn = document.getElementById("logoTextFontAdd");
  const sizeInput = document.getElementById("logoTextSize");
  const colorInput = document.getElementById("logoTextColor");
  const strokeColorInput = document.getElementById("logoTextStrokeColor");
  const strokeWidthInput = document.getElementById("logoTextStrokeWidth");
  const effectSelect = document.getElementById("logoTextEffect");
  const effectSpeed = document.getElementById("logoEffectSpeed");
  const effectColorA = document.getElementById("logoEffectColorA");
  const effectColorB = document.getElementById("logoEffectColorB");
  const effectRainOpacity = document.getElementById("logoEffectRainOpacity");
  const effectToggle = document.getElementById("logoEffectToggle");
  const effectBody = document.getElementById("logoEffectBody");
  const italicInput = document.getElementById("logoTextItalic");
  const curveInput = document.getElementById("logoTextCurve");
  const curveValue = document.getElementById("logoTextCurveValue");

  const updateLayer = (patch) => {
    const layer = getLayerById(selectedLayerId);
    if (!layer || layer.type !== "text") return;
    Object.assign(layer, patch);
    renderWorkspace();
    updateTextSettingsUI();
    updateSizeUI();
  };

  const normalizeFontName = (name) => name.replace(/\s+/g, " ").trim();

  const addFontOption = (family) => {
    if (!fontSelect) return;
    const exists = Array.from(fontSelect.options).some(
      (opt) => opt.value.toLowerCase() === family.toLowerCase()
    );
    if (!exists) {
      const option = document.createElement("option");
      option.value = family;
      option.textContent = family;
      fontSelect.append(option);
    }
  };

  const handleFontFile = async (file) => {
    if (!file) return;
    const rawName = file.name ? file.name.replace(/\.[^.]+$/, "") : "Custom Font";
    const family = normalizeFontName(rawName) || "Custom Font";
    const key = family.toLowerCase();
    let assetPath = "";
    if (currentProjectId && window.stagepadAPI?.importAssetFromBuffer) {
      const buffer = await file.arrayBuffer();
      const extMatch = file.name?.match(/\.[^.]+$/);
      const ext = extMatch ? extMatch[0] : ".ttf";
      const safeName = family.replace(/[^\w\-]+/g, "_");
      const fileName = `${safeName || "font"}${ext}`;
      assetPath = await window.stagepadAPI.importAssetFromBuffer(currentProjectId, fileName, buffer, "logo");
      if (assetPath) {
        assetPath = assetPath.replace(/\\/g, "/");
      }
    }
    if (!customFonts.has(key)) {
      const fontUrl = URL.createObjectURL(file);
      await registerCustomFont({ family, url: fontUrl, assetPath });
    } else if (assetPath) {
      const entry = customFonts.get(key);
      if (entry && !entry.assetPath) entry.assetPath = assetPath;
    }
    addFontOption(family);
    if (fontSelect) {
      fontSelect.value = family;
      updateLayer({ fontFamily: family });
    }
  };

  textInput?.addEventListener("input", (event) => {
    updateLayer({ text: event.target.value });
  });
  fontSelect?.addEventListener("change", (event) => {
    updateLayer({ fontFamily: event.target.value });
  });
  fontAddBtn?.addEventListener("click", () => {
    fontFileInput?.click();
  });
  fontFileInput?.addEventListener("change", async () => {
    const file = fontFileInput.files?.[0];
    if (!file) return;
    try {
      await handleFontFile(file);
    } catch (error) {
      console.error("Не удалось загрузить шрифт:", error);
    } finally {
      fontFileInput.value = "";
    }
  });
  sizeInput?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value <= 0) return;
    updateLayer({ fontSize: value });
  });
  colorInput?.addEventListener("input", (event) => {
    updateLayer({ color: event.target.value });
  });
  strokeColorInput?.addEventListener("input", (event) => {
    updateLayer({ strokeColor: event.target.value });
  });
  strokeWidthInput?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < 0) return;
    updateLayer({ strokeWidth: value });
  });
  effectSelect?.addEventListener("change", (event) => {
    const effect = event.target.value;
    updateLayer({ effect, effectSettings: { ...(DEFAULT_EFFECTS[effect] || {}) } });
  });
  effectSpeed?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    const layer = getLayerById(selectedLayerId);
    if (!layer || layer.type !== "text") return;
    layer.effectSettings = { ...(layer.effectSettings || {}), speed: value };
    renderWorkspace();
    updateTextSettingsUI();
  });
  effectColorA?.addEventListener("input", (event) => {
    const layer = getLayerById(selectedLayerId);
    if (!layer || layer.type !== "text") return;
    layer.effectSettings = { ...(layer.effectSettings || {}), colorA: event.target.value };
    renderWorkspace();
    updateTextSettingsUI();
  });
  effectColorB?.addEventListener("input", (event) => {
    const layer = getLayerById(selectedLayerId);
    if (!layer || layer.type !== "text") return;
    layer.effectSettings = { ...(layer.effectSettings || {}), colorB: event.target.value };
    renderWorkspace();
    updateTextSettingsUI();
  });
  effectRainOpacity?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    const layer = getLayerById(selectedLayerId);
    if (!layer || layer.type !== "text") return;
    layer.effectSettings = { ...(layer.effectSettings || {}), rainOpacity: value };
    renderWorkspace();
    updateTextSettingsUI();
  });
  italicInput?.addEventListener("change", (event) => {
    updateLayer({ italic: event.target.checked });
  });
  curveInput?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    if (curveValue) curveValue.textContent = String(value);
    updateLayer({ curve: value });
  });

  effectToggle?.addEventListener("click", () => {
    const expanded = effectToggle.getAttribute("aria-expanded") === "true";
    effectToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (effectBody) effectBody.hidden = expanded;
  });
};

const bindWorkspaceDrag = () => {
  const workspace = document.getElementById("logoLayers");
  if (!workspace) return;

  const onMove = (event) => {
    if (!draggingLayerId) return;
    const layer = getLayerById(draggingLayerId);
    if (!layer) return;
    const rect = getWorkspaceRect();
    if (!rect) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    dragStart = { x: event.clientX, y: event.clientY };
    const nextOffset = {
      x: (layer.offset?.x || 0) + dx,
      y: (layer.offset?.y || 0) + dy,
    };
    const img = workspace.querySelector(`[data-layer-id="${draggingLayerId}"]`);
    if (!img) return;
    applySnap(layer, img, rect, nextOffset);
    layer.offset = nextOffset;
    updateLayerTransform(img, layer, rect);
  };

  const onUp = () => {
    if (!draggingLayerId) return;
    const img = workspace.querySelector(`[data-layer-id="${draggingLayerId}"]`);
    img?.classList.remove("is-dragging");
    draggingLayerId = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  workspace.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const img = event.target.closest("[data-layer-id]");
    if (!img) return;
    event.preventDefault();
    draggingLayerId = img.dataset.layerId;
    selectLayer(draggingLayerId);
    dragStart = { x: event.clientX, y: event.clientY };
    img.classList.add("is-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
};

const createGuide = (orientation, offset) => {
  guideCounter += 1;
  guides.push({ id: `guide_${guideCounter}`, orientation, offset });
  renderGuides();
};

const bindGuideCreation = () => {
  const workspace = document.getElementById("logoWorkspace");
  if (!workspace) return;
  workspace.addEventListener("dblclick", (event) => {
    const rect = getWorkspaceRect();
    if (!rect) return;
    const edge = 10;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearTop = y <= edge;
    const nearBottom = rect.height - y <= edge;
    const nearLeft = x <= edge;
    const nearRight = rect.width - x <= edge;
    if (nearTop || nearBottom) {
      createGuide("vertical", Math.max(0, Math.min(rect.width, x)));
    } else if (nearLeft || nearRight) {
      createGuide("horizontal", Math.max(0, Math.min(rect.height, y)));
    }
  });
};

const bindGuideDrag = () => {
  const container = document.getElementById("logoGuides");
  if (!container) return;

  const onMove = (event) => {
    if (!draggingGuideId) return;
    const rect = getWorkspaceRect();
    if (!rect) return;
    const guide = guides.find((g) => g.id === draggingGuideId);
    if (!guide) return;
    if (guide.orientation === "vertical") {
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      guide.offset = draggingGuideMirror ? rect.width - x : x;
    } else {
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      guide.offset = draggingGuideMirror ? rect.height - y : y;
    }
    renderGuides();
  };

  const onUp = () => {
    if (!draggingGuideId) return;
    draggingGuideId = null;
    draggingGuideMirror = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  container.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const guideEl = event.target.closest("[data-guide-id]");
    if (!guideEl) return;
    event.preventDefault();
    draggingGuideId = guideEl.dataset.guideId;
    draggingGuideMirror = guideEl.dataset.guideMirror === "true";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
};

const bindWorkspaceZoom = () => {
  const workspace = document.getElementById("logoWorkspace");
  if (!workspace) return;
  workspace.addEventListener(
    "wheel",
    (event) => {
      const layer = getLayerById(selectedLayerId);
      if (!layer) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.01 : -0.01;
      const next = Math.max(0.05, Math.min(MAX_SCALE, (layer.scale ?? 1) + delta));
      layer.scale = next;
      updateScaleUI();
      const img = document.querySelector(`[data-layer-id="${selectedLayerId}"]`);
      if (img) updateLayerTransform(img, layer, getWorkspaceRect());
    },
    { passive: false }
  );
};

const bindWorkspaceFollow = () => {
  const workspace = document.getElementById("logoWorkspace");
  if (!workspace) return;
  workspace.addEventListener("pointermove", (event) => {
    followPointer = { x: event.clientX, y: event.clientY };
    scheduleFollowUpdate();
  });
  workspace.addEventListener("pointerleave", () => {
    followPointer = null;
    scheduleFollowUpdate();
  });
};

const bindLayerToggle = () => {
  const toggle = document.getElementById("logoLayerToggle");
  const body = document.getElementById("logoLayerBody");
  if (!toggle || !body) return;
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    body.hidden = expanded;
  });
};

const dataUrlToArrayBuffer = async (dataUrl) => {
  const res = await fetch(dataUrl);
  return res.arrayBuffer();
};

const saveLogoDesign = async () => {
  if (!currentProjectId || !window.stagepadAPI) return;
  const rect = getWorkspaceRect();
  if (!rect) return;
  const payload = {
    version: 1,
    workspace: { width: rect.width, height: rect.height },
    fonts: Array.from(customFonts.values())
      .filter((entry) => entry && entry.assetPath && entry.family)
      .map((entry) => ({ family: entry.family, assetPath: entry.assetPath })),
    layers: [],
  };

  for (const layer of layers) {
    const element = document.querySelector(`[data-layer-id="${layer.id}"]`);
    const baseSize = element ? getBaseSize(layer, element, rect) : null;
    let assetPath = layer.assetPath || "";
    if (layer.type === "image") {
      if (!assetPath && typeof layer.src === "string" && layer.src.startsWith("data:")) {
        const buffer = await dataUrlToArrayBuffer(layer.src);
        const name = layer.fileName || `logo_${layer.id}.png`;
        assetPath = await window.stagepadAPI.importAssetFromBuffer(currentProjectId, name, buffer, "logo");
        layer.assetPath = assetPath;
      }
    }
    if (assetPath) {
      assetPath = assetPath.replace(/\\/g, "/");
    }
    payload.layers.push({
      id: layer.id,
      type: layer.type || "image",
      name: layer.name || "",
      fileName: layer.fileName || "",
      assetPath,
      offset: { x: layer.offset?.x || 0, y: layer.offset?.y || 0 },
      scale: layer.scale ?? 1,
      size: layer.size || null,
      baseSize: baseSize ? { width: baseSize.width, height: baseSize.height } : null,
      text: layer.text || "",
      fontFamily: layer.fontFamily || "",
      fontSize: layer.fontSize || 0,
      color: layer.color || "",
      strokeColor: layer.strokeColor || "",
      strokeWidth: layer.strokeWidth || 0,
      effect: layer.effect || "none",
      effectSettings: layer.effectSettings || null,
      italic: Boolean(layer.italic),
      curve: layer.curve || 0,
    });
  }

  try {
    await window.stagepadAPI.saveProjectLogo(currentProjectId, payload);
  } catch (error) {
    console.error("Не удалось сохранить дизайн логотипа:", error);
  }
};

const bindLogoSave = () => {
  const saveBtn = document.getElementById("logoSave");
  if (!saveBtn) return;
  saveBtn.addEventListener("click", async () => {
    await saveLogoDesign();
  });
};

bindWindowControls();
bindDevtoolsHotkey();
bindBackButton();
setProjectInfo();
bindLogoPicker();
bindLogoReplace();
bindLayerListActions();
bindLayerReorder();
bindScaleControl();
bindSizeInputs();
bindTextSettings();
bindWorkspaceDrag();
bindGuideCreation();
bindGuideDrag();
bindWorkspaceZoom();
bindWorkspaceFollow();
bindLayerToggle();
bindLogoSave();
renderAll();
initCoverFormat();
window.addEventListener("storage", (event) => {
  if (event.key === COVER_FORMAT_KEY) {
    applyCoverFormat(event.newValue || "");
    applyWorkspaceSize();
    renderAll();
  }
});
window.addEventListener("resize", () => {
  applyWorkspaceSize();
  renderGuides();
});
