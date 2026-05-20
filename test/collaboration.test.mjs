import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollaborationPackage,
  buildDevelopmentWorkItems,
  buildReviewWorkItems,
  ensureProjectCollaboration,
  mergeGeneratedWorkItems,
  normalizeAgentResult,
} from "../src/collaboration.js";

function sampleProject() {
  return {
    id: "project_1",
    title: "Sample Project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    decisionLogs: [],
    artifacts: {
      analysis: {
        oneLineDescription: "Sample",
        targetUser: "PM",
        problem: "Planning is slow",
        valueProposition: "Faster planning",
      },
      mvp: {
        included: [{ name: "Idea intake" }],
      },
      prd: "# PRD",
      development: {
        tasks: [
          { title: "Build API", priority: "high", reason: "Needed for persistence" },
          { title: "Build UI", priority: "medium", reason: "Needed for workflow" },
        ],
      },
      validation: {
        risks: [{ title: "Weak target", severity: "high", mitigation: "Interview users" }],
      },
    },
  };
}

test("buildDevelopmentWorkItems creates stable task ids", () => {
  const items = buildDevelopmentWorkItems(sampleProject());
  assert.deepEqual(
    items.map((item) => item.id),
    ["work_dev_1", "work_dev_2"],
  );
});

test("mergeGeneratedWorkItems preserves existing status", () => {
  const merged = mergeGeneratedWorkItems(
    [{ id: "work_dev_1", status: "in_review", createdAt: "old", updatedAt: "old" }],
    [{ id: "work_dev_1", status: "ready", createdAt: "new", updatedAt: "new" }],
  );
  assert.equal(merged[0].status, "in_review");
  assert.equal(merged[0].createdAt, "old");
});

test("ensureProjectCollaboration adds generated work items", () => {
  const project = sampleProject();
  const collaboration = ensureProjectCollaboration(project);
  assert.ok(collaboration.workItems.some((item) => item.id === "work_dev_1"));
  assert.ok(collaboration.workItems.some((item) => item.id === "work_review_dev_1"));
  assert.ok(collaboration.workItems.some((item) => item.id === "work_val_risk_1"));
});

test("buildReviewWorkItems links review items to developer work items", () => {
  const items = buildReviewWorkItems(sampleProject());
  assert.deepEqual(
    items.map((item) => item.id),
    ["work_review_dev_1", "work_review_dev_2"],
  );
  assert.deepEqual(items[0].blockedBy, ["work_dev_1"]);
  assert.equal(items[0].agentRole, "reviewer");
});

test("buildCollaborationPackage includes handoff inputs", () => {
  const pkg = buildCollaborationPackage(sampleProject());
  assert.equal(pkg.projectId, "project_1");
  assert.equal(pkg.handoffInputs.prd, "# PRD");
  assert.ok(pkg.workItems.length >= 3);
});

test("normalizeAgentResult rejects unknown work item ids", () => {
  const collaboration = ensureProjectCollaboration(sampleProject());
  assert.throws(
    () =>
      normalizeAgentResult(
        {
          agentRole: "developer",
          workItemId: "missing",
          status: "pass",
        },
        collaboration,
      ),
    /Unknown workItemId/,
  );
});

test("normalizeAgentResult accepts valid pass results", () => {
  const collaboration = ensureProjectCollaboration(sampleProject());
  const result = normalizeAgentResult(
    {
      agentRole: "developer",
      workItemId: "work_dev_1",
      status: "pass",
      findings: ["Done"],
      recommendedChanges: ["Add tests"],
    },
    collaboration,
  );
  assert.equal(result.status, "pass");
  assert.equal(result.findings[0], "Done");
  assert.equal(result.recommendedChanges[0], "Add tests");
});

test("normalizeAgentResult accepts reviewer results for review work items", () => {
  const collaboration = ensureProjectCollaboration(sampleProject());
  const result = normalizeAgentResult(
    {
      agentRole: "reviewer",
      workItemId: "work_review_dev_1",
      status: "needs_revision",
      findings: [
        {
          severity: "high",
          file: "src/example.js",
          line: 12,
          title: "Missing regression test",
          recommendation: "Add a focused test.",
        },
      ],
      recommendedChanges: ["Add coverage"],
    },
    collaboration,
  );
  assert.equal(result.agentRole, "reviewer");
  assert.equal(result.status, "needs_revision");
  assert.equal(result.findings[0].severity, "high");
  assert.equal(result.findings[0].file, "src/example.js");
});
