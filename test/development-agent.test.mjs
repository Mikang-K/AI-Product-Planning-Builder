import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const nodeExecutable = process.execPath;
const packagePath = "agents/development-agent/examples/collaboration-package.example.json";
const workItemPath = "agents/development-agent/examples/work-item.example.json";

test("validate-input accepts the example collaboration package and work item", () => {
  const result = spawnSync(nodeExecutable, [
    "agents/development-agent/scripts/validate-input.mjs",
    packagePath,
    workItemPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: development agent input is valid/);
});

test("validate-input rejects work items missing from the package", () => {
  const dir = mkdtempSync(join(tmpdir(), "development-agent-"));
  const missingWorkItemPath = join(dir, "missing-work-item.json");
  writeFileSync(missingWorkItemPath, JSON.stringify({
    id: "missing_work_item",
    agentRole: "developer",
    title: "Missing work item",
    description: "This item is not present in the package.",
    status: "ready",
    acceptanceCriteria: ["It should fail validation."],
    expectedOutput: {},
  }, null, 2));

  const result = spawnSync(nodeExecutable, [
    "agents/development-agent/scripts/validate-input.mjs",
    packagePath,
    missingWorkItemPath,
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing work item id missing_work_item/);
});

test("create-result-template emits a valid developer result template", () => {
  const result = spawnSync(nodeExecutable, [
    "agents/development-agent/scripts/create-result-template.mjs",
    workItemPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const resultTemplate = JSON.parse(result.stdout);
  assert.equal(resultTemplate.agentRole, "developer");
  assert.equal(resultTemplate.workItemId, "work_dev_1");
  assert.equal(resultTemplate.status, "blocked");
  assert.equal(resultTemplate.approvalGate, "requires_user_decision");
});
