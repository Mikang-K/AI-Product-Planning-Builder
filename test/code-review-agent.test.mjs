import test from "node:test";
import assert from "node:assert/strict";

import {
  createReviewResultTemplate,
  validateReviewInput,
  validateReviewResult,
} from "../agents/code-review-agent/scripts/code-review-agent-lib.mjs";

function sampleCollaborationPackage() {
  return {
    projectId: "project_1",
    projectTitle: "Sample Project",
    handoffInputs: {
      prd: "# PRD",
      development: {},
      validation: {},
    },
    workItems: [
      {
        id: "work_dev_1",
        agentRole: "developer",
        status: "pass",
      },
      sampleReviewWorkItem(),
    ],
  };
}

function sampleReviewWorkItem() {
  return {
    id: "work_review_dev_1",
    agentRole: "reviewer",
    title: "Review implementation for work_dev_1",
    description: "Review implementation",
    status: "ready",
    acceptanceCriteria: ["Review scope and tests."],
    blockedBy: ["work_dev_1"],
    expectedOutput: {},
  };
}

test("validateReviewInput accepts a linked review work item", async () => {
  const result = await validateReviewInput(sampleCollaborationPackage(), sampleReviewWorkItem());
  assert.equal(result.ok, true);
});

test("validateReviewInput rejects developer work items", async () => {
  const result = await validateReviewInput(sampleCollaborationPackage(), {
    ...sampleReviewWorkItem(),
    agentRole: "developer",
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /reviewer/);
});

test("createReviewResultTemplate emits a valid structured review result", async () => {
  const resultTemplate = createReviewResultTemplate(sampleReviewWorkItem());
  const validation = await validateReviewResult(resultTemplate);

  assert.equal(validation.ok, true);
  assert.equal(resultTemplate.agentRole, "reviewer");
  assert.equal(resultTemplate.findings[0].severity, "medium");
});
