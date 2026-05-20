import test from "node:test";
import assert from "node:assert/strict";

import { isAllowedLlmEndpoint, parseJsonContent } from "../src/engines/llmClient.js";
import { PlannerEngine } from "../src/engines/plannerEngine.js";

test("PlannerEngine creates a project with generated artifacts and version history", () => {
  const project = PlannerEngine.createProject("AI product planning tool");

  assert.equal(project.currentVersion, 1);
  assert.equal(project.versions.length, 1);
  assert.equal(project.artifacts.development.tasks.length >= 4, true);
  assert.equal(project.artifacts.validation.risks.length >= 2, true);
  assert.equal(project.artifacts.agentPackage.agents.length, 3);
});

test("isAllowedLlmEndpoint only accepts the configured OpenAI chat completions endpoint", () => {
  assert.equal(isAllowedLlmEndpoint("https://api.openai.com/v1/chat/completions"), true);
  assert.equal(isAllowedLlmEndpoint("http://api.openai.com/v1/chat/completions"), false);
  assert.equal(isAllowedLlmEndpoint("https://example.com/v1/chat/completions"), false);
});

test("parseJsonContent parses fenced JSON responses", () => {
  assert.deepEqual(parseJsonContent('```json\n{"ok":true}\n```'), { ok: true });
});
