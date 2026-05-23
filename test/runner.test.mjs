import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBlockedResult,
  buildCodexExecArgs,
  createRunnerConfig,
  normalizeCodexResultForRunner,
  parseCodexResultText,
  runPaths,
  validateCodexRunRequest,
} from "../agents/runner/runner-lib.mjs";

test("validateCodexRunRequest accepts valid requests", () => {
  const request = validateCodexRunRequest({
    projectId: "project_1",
    workItemId: "work_dev_1",
    prompt: "# Task",
    codexPackage: {
      workItem: {
        id: "work_dev_1",
        agentRole: "developer",
      },
    },
  });

  assert.equal(request.projectId, "project_1");
  assert.equal(request.agentRole, "developer");
});

test("validateCodexRunRequest accepts review run requests", () => {
  const request = validateCodexRunRequest({
    projectId: "project_1",
    workItemId: "work_review_dev_1",
    prompt: "# Review",
    codexPackage: {
      packageType: "codex-review",
      workItem: {
        id: "work_review_dev_1",
        agentRole: "reviewer",
      },
    },
  });

  assert.equal(request.packageType, "codex-review");
  assert.equal(request.agentRole, "reviewer");
});

test("validateCodexRunRequest rejects mismatched work item ids", () => {
  assert.throws(
    () =>
      validateCodexRunRequest({
        projectId: "project_1",
        workItemId: "work_dev_1",
        prompt: "# Task",
        codexPackage: {
          workItem: {
            id: "work_dev_2",
            agentRole: "developer",
          },
        },
      }),
    /must match workItemId/,
  );
});

test("buildCodexExecArgs uses workspace-write sandbox", () => {
  const config = createRunnerConfig({ workspaceRoot: "D:/Project/Test", runsDir: "D:/Project/Test/.agent-runs" });
  const paths = runPaths(config, "codex_run_test");
  const args = buildCodexExecArgs(config, paths);

  assert.deepEqual(args.slice(0, 2), ["exec", "--cd"]);
  assert.ok(args.includes("workspace-write"));
  assert.ok(args.includes("--output-last-message"));
  assert.equal(args.includes("--ask-for-approval"), false);
});

test("buildCodexExecArgs uses review schema for review packages", () => {
  const config = createRunnerConfig({ workspaceRoot: "D:/Project/Test", runsDir: "D:/Project/Test/.agent-runs" });
  const paths = runPaths(config, "codex_run_test");
  const args = buildCodexExecArgs(config, paths, "codex-review");

  assert.ok(args.includes(config.schemaPaths["codex-review"]));
});

test("parseCodexResultText parses fenced JSON", () => {
  const parsed = parseCodexResultText('```json\n{"agentRole":"developer"}\n```');
  assert.equal(parsed.agentRole, "developer");
});

test("normalizeCodexResultForRunner validates work item identity", () => {
  const normalized = normalizeCodexResultForRunner(
    {
      agentRole: "developer",
      workItemId: "work_dev_1",
      status: "pass",
      findings: ["Done"],
      recommendedChanges: [],
      changedFiles: [],
      tests: ["node --test"],
      risks: [],
      approvalGate: "approved",
    },
    "work_dev_1",
  );

  assert.equal(normalized.status, "pass");
});

test("normalizeCodexResultForRunner validates reviewer identity", () => {
  const normalized = normalizeCodexResultForRunner(
    {
      agentRole: "reviewer",
      workItemId: "work_review_dev_1",
      status: "pass",
      findings: [
        {
          severity: "low",
          file: "src/example.js",
          line: 7,
          title: "Minor issue",
          recommendation: "Tighten the assertion.",
        },
      ],
      recommendedChanges: [],
      changedFiles: [],
      tests: ["node --test"],
      risks: [],
      approvalGate: "approved",
    },
    "work_review_dev_1",
    "reviewer",
  );

  assert.equal(normalized.agentRole, "reviewer");
  assert.equal(normalized.findings[0].file, "src/example.js");
});

test("buildBlockedResult creates importable agent result", () => {
  const result = buildBlockedResult("work_dev_1", "Codex failed.");
  assert.equal(result.agentRole, "developer");
  assert.equal(result.status, "blocked");
  assert.equal(result.approvalGate, "requires_user_decision");
});

test("buildBlockedResult can create reviewer blocked results", () => {
  const result = buildBlockedResult("work_review_dev_1", "Codex failed.", "codex exec", "reviewer");
  assert.equal(result.agentRole, "reviewer");
  assert.equal(result.status, "blocked");
});
