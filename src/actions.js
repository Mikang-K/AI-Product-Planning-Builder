import { deepClone, id, now } from "./utils.js";

export function clearProjects(state) {
  state.projects = [];
  state.activeProjectId = null;
  state.activeTab = "diagnosis";
}

export function addProjectToState(state, project, options = {}) {
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  state.activeTab = options.activeTab || "diagnosis";
  return project;
}

export function addImportedProjectsToState(state, importedProjects) {
  state.projects = [...importedProjects, ...state.projects];
  state.activeProjectId = importedProjects[0]?.id || state.activeProjectId;
  state.activeTab = "diagnosis";
}

export function selectProject(state, projectId) {
  if (!state.projects.some((project) => project.id === projectId)) return false;
  state.activeProjectId = projectId;
  state.activeTab = "diagnosis";
  return true;
}

export function renameProjectInState(state, projectId, nextTitle) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || !nextTitle) return null;
  project.title = nextTitle;
  project.updatedAt = now();
  return project;
}

export function duplicateProjectInState(state, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const copy = deepClone(project);
  const createdAt = now();
  copy.id = id("project");
  copy.title = `${project.title} 복사본`;
  copy.createdAt = createdAt;
  copy.updatedAt = createdAt;
  copy.decisionLogs = [
    {
      id: id("decision"),
      decision: "프로젝트 복제",
      reason: `${project.title}에서 새 프로젝트를 만들었습니다.`,
      createdAt,
    },
    ...(Array.isArray(copy.decisionLogs) ? copy.decisionLogs : []),
  ];
  state.projects.unshift(copy);
  state.activeProjectId = copy.id;
  return copy;
}

export function deleteProjectFromState(state, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return null;
  state.projects = state.projects.filter((item) => item.id !== projectId);
  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.projects[0]?.id || null;
    state.activeTab = "diagnosis";
  }
  return project;
}

export function updateWorkItemStatus(project, workItemId, status) {
  const collaboration = project.collaboration;
  const item = collaboration?.workItems?.find((workItem) => workItem.id === workItemId);
  if (!item) return null;
  const updatedAt = now();
  item.status = status;
  item.updatedAt = updatedAt;
  collaboration.updatedAt = updatedAt;
  project.updatedAt = updatedAt;
  return item;
}
