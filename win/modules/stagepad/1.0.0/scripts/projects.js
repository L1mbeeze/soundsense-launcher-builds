import { ensureApi } from "./api.js";
import { dom } from "./dom.js";
import { state } from "./state.js";

export const normalizeProjectGroup = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeGroupKey = (value) => normalizeProjectGroup(value).toLocaleLowerCase();
const normalizeSearchValue = (value) => (typeof value === "string" ? value.trim().toLocaleLowerCase() : "");
const trimInstruction = (value) => (typeof value === "string" ? value.trim() : "");
export const DESCRIPTION_LIMIT = 90;
const clampDescription = (value) => (typeof value === "string" ? value.slice(0, DESCRIPTION_LIMIT) : "");
const formatDescription = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "Без описания";
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 3).trimEnd()}...` : text;
};

const COVER_POSITION_MAP = {
  center: "center",
  top: "center top",
  bottom: "center bottom",
  left: "left center",
  right: "right center",
};

function buildCoverStyle(project, coverUrl) {
  if (!coverUrl) return "";
  const size = project.coverFit === "fill" ? "100% 100%" : project.coverFit || "cover";
  const position = COVER_POSITION_MAP[project.coverPosition] || "center";
  const safeUrl = coverUrl.replace(/'/g, "\\'");
  return `background-image:url('${safeUrl}');background-size:${size};background-position:${position};`;
}

export function updateDescriptionCounter() {
  if (!dom.descCounter) return;
  const current = dom.inputDesc?.value || "";
  const remaining = Math.max(DESCRIPTION_LIMIT - current.length, 0);
  dom.descCounter.textContent = `Осталось ${remaining} символов`;
}

export function applyDescriptionLimit(value) {
  if (!dom.inputDesc) return "";
  const nextValue = clampDescription(typeof value === "string" ? value : dom.inputDesc.value || "");
  if (dom.inputDesc.value !== nextValue) {
    dom.inputDesc.value = nextValue;
  }
  updateDescriptionCounter();
  return nextValue;
}

export function handleDescriptionInput() {
  applyDescriptionLimit();
}

function collectProjectGroups(projects = state.projects) {
  const groups = new Map();
  projects.forEach((project) => {
    const group = normalizeProjectGroup(project?.group);
    if (!group) return;
    const key = normalizeGroupKey(group);
    if (!groups.has(key)) {
      groups.set(key, group);
    }
  });
  return Array.from(groups.values()).sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));
}

function setSelectValueCaseInsensitive(selectEl, value, fallback = "") {
  if (!selectEl) return false;
  const match = Array.from(selectEl.options || []).find(
    (option) => normalizeGroupKey(option.value) === normalizeGroupKey(value)
  );
  selectEl.value = match ? match.value : fallback;
  return Boolean(match);
}

function renderGroupSelect(selectEl, groups, { placeholder, targetValue } = {}) {
  if (!selectEl) return;
  const prevValue = targetValue ?? selectEl.value ?? "";
  selectEl.innerHTML = "";
  if (placeholder) {
    const option = document.createElement("option");
    option.value = placeholder.value;
    option.textContent = placeholder.label;
    selectEl.append(option);
  }
  groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group;
    option.textContent = group;
    selectEl.append(option);
  });
  const fallback = placeholder ? placeholder.value : "";
  return setSelectValueCaseInsensitive(selectEl, prevValue, fallback);
}

function getFilteredProjects() {
  const filterKey = normalizeGroupKey(state.projectGroupFilter);
  const search = normalizeSearchValue(state.projectSearchQuery);
  return state.projects.filter((project) => {
    const matchesGroup = filterKey ? normalizeGroupKey(project.group) === filterKey : true;
    if (!matchesGroup) return false;
    if (!search) return true;
    const name = normalizeSearchValue(project.name);
    const desc = normalizeSearchValue(project.description);
    return name.includes(search) || desc.includes(search);
  });
}

export function ensureModalsHidden() {
  if (dom.modalEditor) dom.modalEditor.hidden = true;
  if (dom.modalDelete) dom.modalDelete.hidden = true;
  if (dom.instructionModal) dom.instructionModal.hidden = true;
}

export function renderProjects() {
  if (!dom.projectsList) return;
  const groups = collectProjectGroups();
  const filterMatched = renderGroupSelect(dom.projectGroupFilter, groups, {
    placeholder: { value: "", label: "Все группы" },
    targetValue: state.projectGroupFilter,
  });
  if (!filterMatched && state.projectGroupFilter) {
    state.projectGroupFilter = "";
  }
  renderGroupSelect(dom.selectGroup, groups, {
    placeholder: { value: "", label: "Без группы" },
    targetValue: dom.inputGroup?.value || "",
  });
  if (dom.projectSearch) {
    dom.projectSearch.value = state.projectSearchQuery;
  }
  if (!state.projects.length) {
    dom.projectsList.innerHTML = `
      <div class="empty">
        Пока нет проектов. Нажмите «Добавить проект», чтобы создать первый.
      </div>
    `;
    return;
  }
  const visibleProjects = getFilteredProjects();
  if (!visibleProjects.length) {
    dom.projectsList.innerHTML = `
      <div class="empty">
        В выбранной группе нет проектов. Сбросьте фильтр или создайте новый проект.
      </div>
    `;
    return;
  }
  dom.projectsList.innerHTML = `
    <div class="grid">
      ${visibleProjects
        .map((project) => {
          const coverUrl =
            project.coverImage && window.stagepadAPI?.getAssetFileUrl
              ? window.stagepadAPI.getAssetFileUrl(project.id, project.coverImage)
              : "";
          const coverStyle = buildCoverStyle(project, coverUrl);
          return `
            <div class="card" data-id="${project.id}">
              <div class="card__cover" style="${coverStyle}">
                ${coverUrl ? "" : '<div class="card__cover-placeholder">Обложка проекта</div>'}
              </div>
              <div class="card__meta">
                <div class="tag">ID: ${project.id}</div>
                ${project.group ? `<div class="tag">Группа: ${project.group}</div>` : ""}
              </div>
              <h3 class="card__title">${project.name}</h3>
              <p class="card__desc">${formatDescription(project.description)}</p>
              <div class="card__menu">
                <!-- <button class="btn small" data-action="launch" data-id="${project.id}">Запустить</button> -->
                <!-- <button class="btn ghost small btn--icon" type="button" data-menu-toggle aria-label="Ещё">⋮</button> -->
                <div class="card__menu-list" hidden>
                  <button class="card__menu-item" data-action="edit" data-id="${project.id}">Редактировать</button>
                  <button class="card__menu-item" data-action="rename" data-id="${project.id}">Переименовать</button>
                  <button class="card__menu-item" data-action="instruction" data-id="${project.id}" ${
                    project.instruction ? "" : "disabled"
                  }>Инструкция</button>
                  <button class="card__menu-item" data-action="logo" data-id="${project.id}">Логотип</button>
                  <button class="card__menu-item card__menu-item--danger" data-action="delete" data-id="${project.id}">Удалить</button>
                </div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export async function loadProjects(onAfterLoad) {
  if (!ensureApi()) return;
  try {
    const projects = await window.stagepadAPI.listProjects();
    state.projects = projects.map((project) => ({
      ...project,
      group: normalizeProjectGroup(project.group),
      instruction: trimInstruction(project.instruction),
    }));
    renderProjects();
    if (onAfterLoad) {
      await onAfterLoad();
    }
  } catch (error) {
    console.error("Не удалось загрузить проекты:", error);
    state.projects = [];
    renderProjects();
  }
}

export function openEditorModal(project) {
  state.editingId = project?.id || null;
  if (dom.modalTitle) dom.modalTitle.textContent = state.editingId ? "Редактировать проект" : "Новый проект";
  if (dom.inputName) dom.inputName.value = project?.name || "";
  applyDescriptionLimit(project?.description || "");
  if (dom.inputInstruction) dom.inputInstruction.value = project?.instruction || "";
  if (dom.inputGroup) dom.inputGroup.value = normalizeProjectGroup(project?.group);
  if (dom.modalError) dom.modalError.textContent = "";
  renderGroupSelect(dom.selectGroup, collectProjectGroups(), {
    placeholder: { value: "", label: "Без группы" },
    targetValue: dom.inputGroup?.value || "",
  });
  if (dom.modalEditor) dom.modalEditor.hidden = false;
  dom.inputName?.focus();
}

export function closeEditorModal() {
  if (dom.modalEditor) dom.modalEditor.hidden = true;
  state.editingId = null;
  if (dom.inputName) dom.inputName.value = "";
  applyDescriptionLimit("");
  if (dom.inputInstruction) dom.inputInstruction.value = "";
  if (dom.inputGroup) dom.inputGroup.value = "";
  if (dom.selectGroup) dom.selectGroup.value = "";
  if (dom.modalError) dom.modalError.textContent = "";
}

export function openDeleteModal(project) {
  state.deletingId = project?.id || null;
  if (dom.deleteText) dom.deleteText.textContent = project ? `Точно удалить проект «${project.name}»?` : "";
  if (dom.modalDelete) dom.modalDelete.hidden = false;
}

export function closeDeleteModal() {
  if (dom.modalDelete) dom.modalDelete.hidden = true;
  state.deletingId = null;
}

export function openInstructionModal(project) {
  if (!dom.instructionModal || !dom.instructionText) return;
  if (dom.instructionTitle) {
    dom.instructionTitle.textContent = `Инструкция к «${project?.name || project?.id || ""}»`;
  }
  dom.instructionText.textContent = project?.instruction || "Инструкция не заполнена.";
  dom.instructionModal.hidden = false;
}

export function closeInstructionModal() {
  if (!dom.instructionModal) return;
  dom.instructionModal.hidden = true;
}
