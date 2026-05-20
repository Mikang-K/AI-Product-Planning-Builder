import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCodexDevelopmentPackage,
  buildCodexPrompt,
  buildCodexReviewPackage,
  buildCodexReviewPrompt,
  convertCodexResultToAgentResult,
  normalizeCodexResult,
  validateCodexPackage,
} from "../src/codexWorkflow.js";
import { applyAgentResultToAutomation, createAutomationRun } from "../src/automation.js";
import { ensureProjectCollaboration } from "../src/collaboration.js";

function sampleProject() {
  return {
    id: "project_1",
    title: "Sample Project",
    description: "Sample project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    decisionLogs: [{ decision: "Keep MVP small", reason: "Reduce execution risk" }],
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
      prd: "# PRD\n\nBuild the planning workflow.",
      development: {
        apiSpec: [{ method: "POST", path: "/api/projects" }],
        dataModels: [{ name: "Project" }],
        tasks: [{ title: "Build API", priority: "high", reason: "Needed for persistence" }],
      },
      validation: {
        risks: [{ title: "Weak target", severity: "high", mitigation: "Interview users" }],
      },
    },
  };
}

test("buildCodexDevelopmentPackage creates a valid Codex package", () => {
  const project = sampleProject();
  const pkg = buildCodexDevelopmentPackage(project, "work_dev_1", {
    createdAt: "2026-05-19T00:00:00.000Z",
  });

  assert.equal(pkg.packageType, "codex-development");
  assert.equal(pkg.projectId, "project_1");
  assert.equal(pkg.workItem.id, "work_dev_1");
  assert.equal(pkg.context.prd, project.artifacts.prd);
  assert.deepEqual(pkg.implementationContract.requiredTests, ["node --test"]);
  assert.equal(validateCodexPackage(pkg), true);
});

test("buildCodexDevelopmentPackage rejects validator work items", () => {
  const project = sampleProject();
  ensureProjectCollaboration(project);

  assert.throws(
    () => buildCodexDevelopmentPackage(project, "work_val_risk_1"),
    /Only developer work items/,
  );
});

test("buildCodexReviewPackage creates a valid review package", () => {
  const project = sampleProject();
  const collaboration = ensureProjectCollaboration(project);
  collaboration.agentRuns.unshift({
    agentRole: "developer",
    workItemId: "work_dev_1",
    status: "pass",
    changedFiles: ["src/example.js"],
    tests: ["node --test"],
  });
  const pkg = buildCodexReviewPackage(project, "work_review_dev_1", {
    createdAt: "2026-05-19T00:00:00.000Z",
  });

  assert.equal(pkg.packageType, "codex-review");
  assert.equal(pkg.workItem.agentRole, "reviewer");
  assert.equal(pkg.developerWorkItem.id, "work_dev_1");
  assert.equal(pkg.developerResult.workItemId, "work_dev_1");
  assert.equal(validateCodexPackage(pkg), true);
});

test("buildCodexReviewPrompt includes reviewer output contract", () => {
  const project = sampleProject();
  const pkg = buildCodexReviewPackage(project, "work_review_dev_1");
  const prompt = buildCodexReviewPrompt(pkg);

  assert.match(prompt, /# Codex Code Review Task/);
  assert.match(prompt, /"agentRole": "reviewer"/);
  assert.match(prompt, /"severity": "high"/);
  assert.match(prompt, /work_review_dev_1/);
});

test("buildCodexPrompt includes PRD, work item, and output contract", () => {
  const project = sampleProject();
  const pkg = buildCodexDevelopmentPackage(project, "work_dev_1");
  const prompt = buildCodexPrompt(pkg);

  assert.match(prompt, /# Codex Development Task/);
  assert.match(prompt, /Build the planning workflow/);
  assert.match(prompt, /work_dev_1/);
  assert.match(prompt, /Agent Result JSON/);
});

test("normalizeCodexResult validates required fields and evidence", () => {
  const result = normalizeCodexResult({
    agentRole: "developer",
    workItemId: "work_dev_1",
    status: "pass",
    findings: ["Implemented"],
    recommendedChanges: ["Add browser smoke test"],
    changedFiles: ["src/example.js"],
    tests: ["node --test"],
    risks: [],
    approvalGate: "approved",
    codexEvidence: {
      commands: [{ command: "node --test", status: "pass" }],
      notes: ["Browser automation not available."],
    },
  });

  assert.equal(result.agentRole, "developer");
  assert.equal(result.codexEvidence.commands[0].status, "pass");
});

test("normalizeCodexResult rejects missing workItemId", () => {
  assert.throws(
    () =>
      normalizeCodexResult({
        agentRole: "developer",
        status: "pass",
      }),
    /workItemId is required/,
  );
});

test("convertCodexResultToAgentResult returns Product Builder compatible result", () => {
  const agentResult = convertCodexResultToAgentResult({
    agentRole: "developer",
    workItemId: "work_dev_1",
    status: "needs_revision",
    findings: ["Requirement is unclear"],
    recommendedChanges: [],
    changedFiles: [],
    tests: ["node --test"],
    risks: ["Need storage decision"],
    approvalGate: "requires_user_decision",
  });

  assert.equal(agentResult.status, "needs_revision");
  assert.deepEqual(agentResult.tests, ["node --test"]);
});

test("convertCodexResultToAgentResult accepts reviewer results", () => {
  const agentResult = convertCodexResultToAgentResult({
    agentRole: "reviewer",
    workItemId: "work_review_dev_1",
    status: "pass",
    findings: [
      {
        severity: "info",
        file: "src/main.js",
        title: "Looks good",
        recommendation: "No change needed.",
      },
    ],
    recommendedChanges: [],
    changedFiles: [],
    tests: ["node --test"],
    risks: [],
    approvalGate: "approved",
  });

  assert.equal(agentResult.agentRole, "reviewer");
  assert.equal(agentResult.status, "pass");
  assert.equal(agentResult.findings[0].severity, "info");
});

test("Codex result import preserves codexEvidence in agent runs", () => {
  const project = sampleProject();
  createAutomationRun(project, "work_dev_1", { id: "automation_run_test" });
  applyAgentResultToAutomation(project, {
    agentRole: "developer",
    workItemId: "work_dev_1",
    status: "pass",
    findings: ["Done"],
    recommendedChanges: [],
    changedFiles: ["src/example.js"],
    tests: ["node --test"],
    risks: [],
    approvalGate: "approved",
    codexEvidence: {
      commands: [{ command: "node --test", status: "pass" }],
      notes: ["OK"],
    },
  });
  const collaboration = ensureProjectCollaboration(project);

  assert.equal(collaboration.agentRuns[0].codexEvidence.commands[0].command, "node --test");
});
