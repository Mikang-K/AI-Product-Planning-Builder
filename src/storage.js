import { deepClone, id, now } from "./utils.js";

export function sanitizePersistedLlmConfig(config = {}) {
  const { apiKey, ...persistedConfig } = config || {};
  return {
    ...persistedConfig,
    apiKey: "",
  };
}

export function buildPersistedState(state) {
  const { apiKey, ...persistedLlmConfig } = state.llmConfig || {};
  return {
    projects: state.projects || [],
    activeProjectId: state.activeProjectId || null,
    activeTab: state.activeTab || "diagnosis",
    llmConfig: persistedLlmConfig,
  };
}

export function readPersistedState(storage, storeKey) {
  const raw = storage.getItem(storeKey);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return {
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    activeProjectId: parsed.activeProjectId || null,
    activeTab: parsed.activeTab || "diagnosis",
    llmConfig: sanitizePersistedLlmConfig(parsed.llmConfig),
  };
}

export function writePersistedState(storage, storeKey, state) {
  storage.setItem(storeKey, JSON.stringify(buildPersistedState(state)));
}

export function normalizeImportedProjects(payload, existingProjects = [], validateProject = () => {}) {
  const candidates = Array.isArray(payload?.projects) ? payload.projects : Array.isArray(payload) ? payload : [payload];
  const existingIds = new Set(existingProjects.map((project) => project.id));
  const importedProjects = candidates.map((project) => normalizeImportedProject(project, existingIds, validateProject));
  if (!importedProjects.length) {
    throw new Error("가져올 프로젝트가 없습니다.");
  }
  return importedProjects;
}

export function normalizeImportedProject(project, existingIds = new Set(), validateProject = () => {}) {
  if (!project || typeof project !== "object" || !project.artifacts) {
    throw new Error("프로젝트 JSON 구조가 올바르지 않습니다.");
  }

  validateProject(project);

  const imported = deepClone(project);
  const createdAt = typeof imported.createdAt === "string" ? imported.createdAt : now();
  const updatedAt = now();
  imported.id = uniqueImportedProjectId(existingIds);
  imported.title = typeof imported.title === "string" && imported.title.trim() ? imported.title.trim() : "가져온 프로젝트";
  imported.description =
    typeof imported.description === "string" && imported.description.trim()
      ? imported.description.trim()
      : imported.artifacts.analysis?.oneLineDescription || imported.title;
  imported.createdAt = createdAt;
  imported.updatedAt = updatedAt;
  imported.currentVersion = Number.isFinite(Number(imported.currentVersion)) ? Number(imported.currentVersion) : 1;
  imported.decisionLogs = Array.isArray(imported.decisionLogs) ? imported.decisionLogs : [];
  imported.changeLogs = Array.isArray(imported.changeLogs) ? imported.changeLogs : [];
  imported.versions = Array.isArray(imported.versions) && imported.versions.length ? imported.versions : [
    {
      version: imported.currentVersion,
      createdAt,
      feedback: "가져오기",
      changedSections: ["가져온 프로젝트"],
      artifacts: deepClone(imported.artifacts),
    },
  ];
  imported.decisionLogs.unshift({
    id: id("decision"),
    decision: "프로젝트 가져오기",
    reason: "JSON 파일에서 프로젝트를 복원했습니다.",
    createdAt: updatedAt,
  });
  return imported;
}

export function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, filename);
}

export function downloadText(value, filename, type) {
  const blob = new Blob([value], { type });
  downloadBlob(blob, filename);
}

function uniqueImportedProjectId(existingIds) {
  let nextId = id("project");
  while (existingIds.has(nextId)) {
    nextId = id("project");
  }
  existingIds.add(nextId);
  return nextId;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
