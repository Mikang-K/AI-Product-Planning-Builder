import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAgentResultToAutomation,
  automationRunStatuses,
  buildDevelopmentAgentBatch,
  buildDevelopmentAgentCliCommand,
  buildDevelopmentAgentInput,
  createAutomationRun,
  createReviewAutomationRun,
  getRunnableDevelopmentWorkItems,
} from "../src/automation.js";
import { ensureProjectCollaboration } from "../src/collaboration.js";

function sampleProject() {
  return {
    id: "project_1",
    title: "Sample Project",
    description: "Sample project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    decisionLogs: [],
    changeLogs: [],
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

test("automationRunStatuses exposes allowed run states", () => {
  assert.deepEqual(automationRunStatuses(), ["queued", "running", "completed", "failed", "cancelled"]);
});

test("getRunnableDevelopmentWorkItems selects only runnable developer items", () => {
  const project = sampleProject();
  const collaboration = ensureProjectCollaboration(project);
  collaboration.workItems.find((item) => item.id === "work_dev_2").status = "in_review";
  collaboration.workItems.push({
    id: "custom_validator",
    agentRole: "validator",
    status: "ready",
  });

  const items = getRunnableDevelopmentWorkItems(project);
  assert.deepEqual(
    items.map((item) => item.id),
    ["work_dev_1"],
  );
});

test("createAutomationRun records run state and marks ready work items as exported", () => {
  const project = sampleProject();
  const run = createAutomationRun(project, ["work_dev_1"], {
    id: "automation_run_test",
    createdAt: "2026-05-19T00:00:00.000Z",
  });
  const collaboration = ensureProjectCollaboration(project);

  assert.equal(run.id, "automation_run_test");
  assert.equal(run.status, "queued");
  assert.equal(collaboration.automationRuns[0].id, "automation_run_test");
  assert.equal(collaboration.workItems.find((item) => item.id === "work_dev_1").status, "exported");
});

test("createAutomationRun rejects developer items already in review", () => {
  const project = sampleProject();
  const collaboration = ensureProjectCollaboration(project);
  collaboration.workItems.find((item) => item.id === "work_dev_1").status = "in_review";

  assert.throws(
    () => createAutomationRun(project, "work_dev_1"),
    /not runnable from status in_review/,
  );
});

test("createAutomationRun can mark a runnable work item as in review", () => {
  const project = sampleProject();
  createAutomationRun(project, "work_dev_1", {
    status: "running",
    workItemStatus: "in_review",
  });
  const collaboration = ensureProjectCollaboration(project);

  assert.equal(collaboration.automationRuns[0].status, "running");
  assert.equal(collaboration.workItems.find((item) => item.id === "work_dev_1").status, "in_review");
});

test("buildDevelopmentAgentInput includes package, work item, and run reference", () => {
  const project = sampleProject();
  const run = createAutomationRun(project, "work_dev_1", { id: "automation_run_test" });
  const input = buildDevelopmentAgentInput(project, "work_dev_1", run);

  assert.equal(input.collaborationPackage.projectId, "project_1");
  assert.equal(input.workItem.id, "work_dev_1");
  assert.equal(input.run.id, "automation_run_test");
});

test("buildDevelopmentAgentBatch bundles runnable developer inputs", () => {
  const project = sampleProject();
  const items = getRunnableDevelopmentWorkItems(project);
  const run = createAutomationRun(project, items.map((item) => item.id), { id: "automation_run_test" });
  const batch = buildDevelopmentAgentBatch(project, items, run);

  assert.equal(batch.projectId, "project_1");
  assert.equal(batch.inputs.length, 2);
  assert.equal(batch.inputs[0].workItem.agentRole, "developer");
});

test("applyAgentResultToAutomation updates work item, agent runs, and automation run", () => {
  const project = sampleProject();
  createAutomationRun(project, "work_dev_1", { id: "automation_run_test" });
  const normalized = applyAgentResultToAutomation(
    project,
    {
      agentRole: "developer",
      workItemId: "work_dev_1",
      status: "pass",
      findings: ["Done"],
      recommendedChanges: ["Add endpoint tests"],
      changedFiles: ["src/server.js"],
      tests: ["node --test"],
      risks: [],
      approvalGate: "approved",
    },
    "automation_run_test",
  );
  const collaboration = ensureProjectCollaboration(project);

  assert.equal(normalized.status, "pass");
  assert.equal(collaboration.workItems.find((item) => item.id === "work_dev_1").status, "pass");
  assert.equal(collaboration.workItems.find((item) => item.id === "work_review_dev_1").status, "ready");
  assert.equal(collaboration.agentRuns[0].workItemId, "work_dev_1");
  assert.equal(collaboration.automationRuns[0].status, "completed");
  assert.equal(project.changeLogs[0].changedSection, "Agent Recommendations");
});

test("reviewer needs_revision result returns linked developer work item to needs_revision", () => {
  const project = sampleProject();
  const collaboration = ensureProjectCollaboration(project);
  collaboration.workItems.find((item) => item.id === "work_dev_1").status = "pass";
  collaboration.workItems.find((item) => item.id === "work_review_dev_1").status = "in_review";

  applyAgentResultToAutomation(project, {
    agentRole: "reviewer",
    workItemId: "work_review_dev_1",
    status: "needs_revision",
    findings: ["Missing regression test"],
    recommendedChanges: ["Add test coverage"],
    changedFiles: [],
    tests: ["node --test"],
    risks: [],
    approvalGate: "requires_user_decision",
  });

  assert.equal(collaboration.workItems.find((item) => item.id === "work_review_dev_1").status, "needs_revision");
  assert.equal(collaboration.workItems.find((item) => item.id === "work_dev_1").status, "needs_revision");
});

test("createReviewAutomationRun records separate review automation runs", () => {
  const project = sampleProject();
  const collaboration = ensureProjectCollaboration(project);
  collaboration.workItems.find((item) => item.id === "work_dev_1").status = "pass";
  collaboration.workItems.find((item) => item.id === "work_review_dev_1").status = "ready";

  const run = createReviewAutomationRun(project, "work_review_dev_1", {
    id: "review_automation_run_test",
    createdAt: "2026-05-20T00:00:00.000Z",
  });

  assert.equal(run.agentRole, "reviewer");
  assert.equal(collaboration.reviewAutomationRuns[0].id, "review_automation_run_test");
  assert.equal(collaboration.automationRuns.length, 0);
  assert.equal(collaboration.workItems.find((item) => item.id === "work_review_dev_1").status, "exported");
});

test("reviewer result updates matching review automation run", () => {
  const project = sampleProject();
  const collaboration = ensureProjectCollaboration(project);
  collaboration.workItems.find((item) => item.id === "work_dev_1").status = "pass";
  collaboration.workItems.find((item) => item.id === "work_review_dev_1").status = "ready";
  createReviewAutomationRun(project, "work_review_dev_1", {
    id: "review_automation_run_test",
    status: "running",
    workItemStatus: "in_review",
  });

  applyAgentResultToAutomation(
    project,
    {
      agentRole: "reviewer",
      workItemId: "work_review_dev_1",
      status: "pass",
      findings: [{ severity: "info", title: "Reviewed" }],
      recommendedChanges: [],
      changedFiles: [],
      tests: ["node --test"],
      risks: [],
      approvalGate: "approved",
    },
    "review_automation_run_test",
  );

  assert.equal(collaboration.reviewAutomationRuns[0].status, "completed");
  assert.equal(collaboration.reviewAutomationRuns[0].resultIds.length, 1);
  assert.equal(collaboration.automationRuns.length, 0);
});

test("applyAgentResultToAutomation rejects validator result for developer work item", () => {
  const project = sampleProject();
  createAutomationRun(project, "work_dev_1", { id: "automation_run_test" });

  assert.throws(
    () =>
      applyAgentResultToAutomation(project, {
        agentRole: "validator",
        workItemId: "work_dev_1",
        status: "pass",
      }),
    /agentRole does not match/,
  );
});

test("buildDevelopmentAgentCliCommand uses development agent scripts", () => {
  const command = buildDevelopmentAgentCliCommand("package.json", "work-item.json", "result.json");
  assert.match(command, /validate-input\.mjs package\.json work-item\.json/);
  assert.match(command, /create-result-template\.mjs work-item\.json result\.json/);
});
