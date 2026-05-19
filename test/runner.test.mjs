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

test("buildBlockedResult creates importable agent result", () => {
  const result = buildBlockedResult("work_dev_1", "Codex failed.");
  assert.equal(result.agentRole, "developer");
  assert.equal(result.status, "blocked");
  assert.equal(result.approvalGate, "requires_user_decision");
});
