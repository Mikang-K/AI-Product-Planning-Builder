import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPersistedState,
  normalizeImportedProjects,
  readPersistedState,
  sanitizePersistedLlmConfig,
  writePersistedState,
} from "../src/storage.js";

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

test("sanitizePersistedLlmConfig removes apiKey", () => {
  assert.deepEqual(sanitizePersistedLlmConfig({ enabled: true, model: "gpt", apiKey: "secret" }), {
    enabled: true,
    model: "gpt",
    apiKey: "",
  });
});

test("buildPersistedState excludes apiKey from persisted llmConfig", () => {
  const persisted = buildPersistedState({
    projects: [],
    activeProjectId: "project_1",
    activeTab: "agents",
    llmConfig: {
      enabled: true,
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt",
      apiKey: "secret",
    },
  });
  assert.equal("apiKey" in persisted.llmConfig, false);
});

test("writePersistedState and readPersistedState do not restore apiKey", () => {
  const storage = memoryStorage();
  writePersistedState(storage, "key", {
    projects: [],
    activeProjectId: null,
    activeTab: "diagnosis",
    llmConfig: { enabled: true, model: "gpt", apiKey: "secret" },
  });
  const parsedRaw = JSON.parse(storage.getItem("key"));
  assert.equal("apiKey" in parsedRaw.llmConfig, false);
  assert.equal(readPersistedState(storage, "key").llmConfig.apiKey, "");
});

test("normalizeImportedProjects assigns a new id and default version", () => {
  const [project] = normalizeImportedProjects(
    {
      id: "project_1",
      title: "Imported",
      artifacts: {
        analysis: { oneLineDescription: "Imported project" },
      },
    },
    [{ id: "project_1" }],
  );
  assert.notEqual(project.id, "project_1");
  assert.equal(project.currentVersion, 1);
  assert.equal(project.versions.length, 1);
  assert.equal(project.decisionLogs[0].decision, "프로젝트 가져오기");
});

test("normalizeImportedProjects rejects missing artifacts", () => {
  assert.throws(() => normalizeImportedProjects({ title: "Bad" }), /프로젝트 JSON 구조/);
});
