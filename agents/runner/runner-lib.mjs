import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const resultStatuses = ["pass", "needs_revision", "blocked"];
const approvalGates = ["approved", "requires_user_decision"];

export function createRunnerConfig(options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot || process.cwd());
  const runsDir = resolve(options.runsDir || resolve(workspaceRoot, ".agent-runs"));
  const developmentSchemaPath =
    options.schemaPath ||
    resolve(workspaceRoot, "agents/codex-development-agent/schemas/codex-result.schema.json");
  const reviewSchemaPath =
    options.reviewSchemaPath ||
    resolve(workspaceRoot, "agents/codex-development-agent/schemas/codex-review-result.schema.json");
  return {
    workspaceRoot,
    runsDir,
    codexBin: options.codexBin || process.env.CODEX_BIN || "codex",
    schemaPath: developmentSchemaPath,
    schemaPaths: {
      "codex-development": developmentSchemaPath,
      "codex-review": reviewSchemaPath,
    },
  };
}

export function createRunId(prefix = "codex_run") {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function assertSafeRunId(runId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(runId || ""))) {
    throw new Error("Invalid run id.");
  }
  return runId;
}

export function runPaths(config, runId) {
  assertSafeRunId(runId);
  const runDir = resolve(config.runsDir, runId);
  if (!runDir.startsWith(resolve(config.runsDir))) {
    throw new Error("Run directory escaped the runs root.");
  }
  return {
    runDir,
    packagePath: resolve(runDir, "package.json"),
    promptPath: resolve(runDir, "prompt.md"),
    resultPath: resolve(runDir, "result.json"),
    statusPath: resolve(runDir, "status.json"),
    stdoutPath: resolve(runDir, "stdout.jsonl"),
    stderrPath: resolve(runDir, "stderr.log"),
  };
}

export async function ensureRunDir(paths) {
  await mkdir(paths.runDir, { recursive: true });
}

export function validateCodexRunRequest(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Request body must be an object.");
  }
  if (!payload.projectId) errors.push("projectId is required.");
  if (!payload.workItemId) errors.push("workItemId is required.");
  if (!payload.codexPackage || typeof payload.codexPackage !== "object") errors.push("codexPackage is required.");
  if (typeof payload.prompt !== "string" || !payload.prompt.trim()) errors.push("prompt is required.");
  if (payload.codexPackage?.workItem?.id && payload.codexPackage.workItem.id !== payload.workItemId) {
    errors.push("codexPackage.workItem.id must match workItemId.");
  }
  if (payload.codexPackage?.packageType && !["codex-development", "codex-review"].includes(payload.codexPackage.packageType)) {
    errors.push("codexPackage.packageType must be codex-development or codex-review.");
  }
  const expectedRole = payload.codexPackage?.packageType === "codex-review" ? "reviewer" : "developer";
  if (payload.codexPackage?.workItem?.agentRole && payload.codexPackage.workItem.agentRole !== expectedRole) {
    errors.push(`codexPackage.workItem.agentRole must be ${expectedRole}.`);
  }
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  return {
    projectId: String(payload.projectId),
    workItemId: String(payload.workItemId),
    codexPackage: payload.codexPackage,
    prompt: payload.prompt,
    packageType: payload.codexPackage?.packageType || "codex-development",
    agentRole: expectedRole,
  };
}

export function buildCodexExecArgs(config, paths, packageType = "codex-development") {
  const schemaPath = resolveSchemaPath(config, packageType);
  return [
    "exec",
    "--cd",
    config.workspaceRoot,
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "never",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    paths.resultPath,
    "--json",
    "-",
  ];
}

export function normalizeCodexResultForRunner(result, workItemId, expectedRole = "developer") {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Codex result must be an object.");
  }
  const normalized = {
    agentRole: String(result.agentRole || "").trim(),
    workItemId: String(result.workItemId || "").trim(),
    status: String(result.status || "").trim(),
    findings: normalizeFindings(result.findings),
    recommendedChanges: normalizeStringArray(result.recommendedChanges),
    changedFiles: normalizeStringArray(result.changedFiles),
    tests: normalizeStringArray(result.tests),
    risks: normalizeStringArray(result.risks),
    approvalGate: approvalGates.includes(result.approvalGate) ? result.approvalGate : "approved",
  };
  if (normalized.agentRole !== expectedRole) throw new Error(`agentRole must be ${expectedRole}.`);
  if (normalized.workItemId !== workItemId) throw new Error("workItemId does not match the run request.");
  if (!resultStatuses.includes(normalized.status)) {
    throw new Error("status must be pass, needs_revision, or blocked.");
  }
  if (result.codexEvidence && typeof result.codexEvidence === "object" && !Array.isArray(result.codexEvidence)) {
    normalized.codexEvidence = {
      commands: Array.isArray(result.codexEvidence.commands) ? result.codexEvidence.commands : [],
      notes: normalizeStringArray(result.codexEvidence.notes),
    };
  }
  return normalized;
}

export function parseCodexResultText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Codex result is empty.");
  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Codex result did not contain valid JSON.");
}

export function buildBlockedResult(workItemId, reason, command = "codex exec", agentRole = "developer") {
  return {
    agentRole,
    workItemId,
    status: "blocked",
    findings: [],
    recommendedChanges: [],
    changedFiles: [],
    tests: [],
    risks: [reason || "Codex execution failed."],
    approvalGate: "requires_user_decision",
    codexEvidence: {
      commands: [{ command, status: "failed" }],
      notes: [reason || "Codex execution failed."],
    },
  };
}

function resolveSchemaPath(config, packageType = "codex-development") {
  return config.schemaPaths?.[packageType] || config.schemaPath;
}

export async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function normalizeFindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeFinding)
    .filter((finding) => (typeof finding === "string" ? finding : finding.title || finding.recommendation || finding.file));
}

function normalizeFinding(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const severity = normalizeSeverity(value.severity);
  const line = Number(value.line);
  const finding = {
    severity,
    title: normalizeText(value.title || value.summary || value.message),
    recommendation: normalizeText(value.recommendation || value.recommendedChange),
  };
  const file = normalizeText(value.file || value.path || value.filename);
  const description = normalizeText(value.description || value.detail || value.reason);
  if (file) finding.file = file;
  if (Number.isInteger(line) && line > 0) finding.line = line;
  if (description) finding.description = description;
  return finding;
}

function normalizeSeverity(value) {
  const severity = String(value || "medium").trim().toLowerCase();
  return ["critical", "high", "medium", "low", "info"].includes(severity) ? severity : "medium";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
