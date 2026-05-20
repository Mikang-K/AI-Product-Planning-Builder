import test from "node:test";
import assert from "node:assert/strict";

import {
  addImportedProjectsToState,
  addProjectToState,
  clearProjects,
  deleteProjectFromState,
  duplicateProjectInState,
  renameProjectInState,
  selectProject,
  updateWorkItemStatus,
} from "../src/actions.js";

function stateWithProjects() {
  return {
    projects: [
      {
        id: "project_1",
        title: "Original",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        decisionLogs: [],
      },
    ],
    activeProjectId: "project_1",
    activeTab: "diagnosis",
  };
}

test("project actions select, rename, duplicate, and delete projects", () => {
  const state = stateWithProjects();

  assert.equal(selectProject(state, "project_1"), true);
  renameProjectInState(state, "project_1", "Renamed");
  assert.equal(state.projects[0].title, "Renamed");

  const copy = duplicateProjectInState(state, "project_1");
  assert.equal(state.projects.length, 2);
  assert.equal(state.activeProjectId, copy.id);
  assert.notEqual(copy.id, "project_1");
  assert.equal(copy.title, "Renamed 복사본");

  deleteProjectFromState(state, copy.id);
  assert.equal(state.projects.length, 1);
  assert.equal(state.activeProjectId, "project_1");
});

test("clearProjects and import/add actions update active state", () => {
  const state = stateWithProjects();
  clearProjects(state);
  assert.deepEqual(state.projects, []);
  assert.equal(state.activeProjectId, null);

  addProjectToState(state, { id: "project_2", title: "Generated" }, { activeTab: "agents" });
  assert.equal(state.activeProjectId, "project_2");
  assert.equal(state.activeTab, "agents");

  addImportedProjectsToState(state, [{ id: "project_3", title: "Imported" }]);
  assert.equal(state.projects[0].id, "project_3");
  assert.equal(state.activeProjectId, "project_3");
  assert.equal(state.activeTab, "diagnosis");
});

test("updateWorkItemStatus updates item, collaboration, and project timestamps", () => {
  const project = {
    updatedAt: "old",
    collaboration: {
      updatedAt: "old",
      workItems: [{ id: "work_1", status: "ready", updatedAt: "old" }],
    },
  };

  const item = updateWorkItemStatus(project, "work_1", "blocked");
  assert.equal(item.status, "blocked");
  assert.notEqual(item.updatedAt, "old");
  assert.equal(project.updatedAt, item.updatedAt);
  assert.equal(project.collaboration.updatedAt, item.updatedAt);
});
