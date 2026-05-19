import { buildCollaborationPackage, ensureProjectCollaboration } from "./collaboration.js";
import { deepClone, now } from "./utils.js";

const resultStatuses = ["pass", "needs_revision", "blocked"];
const approvalGates = ["approved", "requires_user_decision"];

export function buildCodexDevelopmentPackage(project, workItem, options = {}) {
  const collaborationPackage = buildCollaborationPackage(project);
  const selectedWorkItem = resolveDevelopmentWorkItem(collaborationPackage.workItems, workItem);
  const artifacts = project.artifacts || {};

  return {
    packageType: "codex-development",
    version: 1,
    projectId: project.id,
    projectTitle: project.title,
    createdAt: options.createdAt || now(),
    workItem: deepClone(selectedWorkItem),
    context: {
      prd: artifacts.prd || "",
      developmentPackage: deepClone(artifacts.development || {}),
      validationPackage: deepClone(artifacts.validation || {}),
      projectContext: deepClone(collaborationPackage.projectContext || {}),
      decisionLogs: deepClone(project.decisionLogs || []),
    },
    implementationContract: {
      scope: normalizeStringArray(options.scope).length
        ? normalizeStringArray(options.scope)
        : normalizeStringArray(selectedWorkItem.acceptanceCriteria),
      outOfScope: normalizeStringArray(options.outOfScope),
      expectedChangedFiles: normalizeStringArray(selectedWorkItem.expectedOutput?.changedFiles),
      requiredTests: normalizeStringArray(options.requiredTests).length ? normalizeStringArray(options.requiredTests) : ["node --test"],
      riskChecks: normalizeStringArray(options.riskChecks).length
        ? normalizeStringArray(options.riskChecks)
        : normalizeValidationRisks(artifacts.validation?.risks),
    },
    resultContract: {
      format: "agent-result-json",
      requiredFields: [
        "agentRole",
        "workItemId",
        "status",
        "findings",
        "recommendedChanges",
        "changedFiles",
        "tests",
        "risks",
        "approvalGate",
      ],
    },
  };
}

export function buildCodexPrompt(codexPackage) {
  validateCodexPackage(codexPackage);
  return `# Codex Development Task

## Role

당신은 이 저장소에서 작업하는 시니어 개발 에이전트입니다.

## Project Context

${formatJson(codexPackage.context.projectContext)}

## PRD

${codexPackage.context.prd || "No PRD was provided."}

## Development Package

${formatJson(codexPackage.context.developmentPackage)}

## Validation Package

${formatJson(codexPackage.context.validationPackage)}

## Selected Work Item

${formatJson(codexPackage.workItem)}

## Acceptance Criteria

${formatList(codexPackage.workItem.acceptanceCriteria)}

## Implementation Contract

Scope:
${formatList(codexPackage.implementationContract.scope)}

Out of scope:
${formatList(codexPackage.implementationContract.outOfScope)}

Required tests:
${formatList(codexPackage.implementationContract.requiredTests)}

Risk checks:
${formatList(codexPackage.implementationContract.riskChecks)}

## Instructions

1. 저장소 구조를 먼저 파악하세요.
2. 작업 범위를 MVP에 맞게 제한하세요.
3. 필요한 파일만 수정하세요.
4. 테스트 또는 검증 명령을 실행하세요.
5. 변경 파일, 테스트 결과, 남은 리스크를 정리하세요.
6. 반드시 Product Builder가 가져올 수 있는 Agent Result JSON을 반환하세요.

## Output

\`\`\`json
{
  "agentRole": "developer",
  "workItemId": "${codexPackage.workItem.id}",
  "status": "pass",
  "findings": [],
  "recommendedChanges": [],
  "changedFiles": [],
  "tests": [],
  "risks": [],
  "approvalGate": "approved",
  "codexEvidence": {
    "commands": [],
    "notes": []
  }
}
\`\`\`
`;
}

export function normalizeCodexResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Codex result must be an object.");
  }
  const normalized = {
    agentRole: String(result.agentRole || "").trim(),
    workItemId: String(result.workItemId || "").trim(),
    status: String(result.status || "").trim(),
    findings: normalizeStringArray(result.findings),
    recommendedChanges: normalizeStringArray(result.recommendedChanges),
    changedFiles: normalizeStringArray(result.changedFiles),
    tests: normalizeStringArray(result.tests),
    risks: normalizeStringArray(result.risks),
    approvalGate: approvalGates.includes(result.approvalGate) ? result.approvalGate : "approved",
  };

  if (normalized.agentRole !== "developer") {
    throw new Error("Codex result agentRole must be developer.");
  }
  if (!normalized.workItemId) {
    throw new Error("Codex result workItemId is required.");
  }
  if (!resultStatuses.includes(normalized.status)) {
    throw new Error("Codex result status must be pass, needs_revision, or blocked.");
  }
  if (result.codexEvidence && typeof result.codexEvidence === "object" && !Array.isArray(result.codexEvidence)) {
    normalized.codexEvidence = normalizeCodexEvidence(result.codexEvidence);
  }
  return normalized;
}

export function convertCodexResultToAgentResult(result) {
  return normalizeCodexResult(result);
}

export function validateCodexPackage(codexPackage) {
  const errors = [];
  if (!codexPackage || typeof codexPackage !== "object" || Array.isArray(codexPackage)) {
    throw new Error("Codex package must be an object.");
  }
  if (codexPackage.packageType !== "codex-development") errors.push("packageType must be codex-development.");
  if (codexPackage.version !== 1) errors.push("version must be 1.");
  if (!codexPackage.projectId) errors.push("projectId is required.");
  if (!codexPackage.projectTitle) errors.push("projectTitle is required.");
  if (!codexPackage.workItem) errors.push("workItem is required.");
  if (codexPackage.workItem?.agentRole !== "developer") errors.push("workItem.agentRole must be developer.");
  if (!codexPackage.workItem?.id) errors.push("workItem.id is required.");
  if (!codexPackage.context?.prd) errors.push("context.prd is required.");
  if (!codexPackage.context?.developmentPackage) errors.push("context.developmentPackage is required.");
  if (!Array.isArray(codexPackage.implementationContract?.scope)) errors.push("implementationContract.scope must be an array.");
  if (!Array.isArray(codexPackage.implementationContract?.requiredTests)) {
    errors.push("implementationContract.requiredTests must be an array.");
  }
  if (codexPackage.resultContract?.format !== "agent-result-json") errors.push("resultContract.format must be agent-result-json.");
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  return true;
}

export function getCodexDevelopmentWorkItem(project, workItemId) {
  const collaboration = ensureProjectCollaboration(project);
  return resolveDevelopmentWorkItem(collaboration.workItems, workItemId);
}

function resolveDevelopmentWorkItem(workItems, workItem) {
  const workItemId = typeof workItem === "string" ? workItem : workItem?.id;
  const selectedWorkItem = workItems.find((item) => item.id === workItemId);
  if (!selectedWorkItem) {
    throw new Error(`Unknown workItemId: ${workItemId || ""}`);
  }
  if (selectedWorkItem.agentRole !== "developer") {
    throw new Error("Only developer work items can be packaged for Codex.");
  }
  return selectedWorkItem;
}

function normalizeValidationRisks(risks) {
  if (!Array.isArray(risks)) return [];
  return risks
    .map((risk) => {
      if (typeof risk === "string") return risk;
      return risk?.title || risk?.mitigation || risk?.reason || "";
    })
    .filter(Boolean);
}

function normalizeCodexEvidence(evidence) {
  return {
    commands: Array.isArray(evidence.commands)
      ? evidence.commands
          .filter((command) => command && typeof command === "object")
          .map((command) => ({
            command: String(command.command || "").trim(),
            status: String(command.status || "").trim() || "unknown",
          }))
          .filter((command) => command.command)
      : [],
    notes: normalizeStringArray(evidence.notes),
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function formatJson(value) {
  return `\`\`\`json\n${JSON.stringify(value || {}, null, 2)}\n\`\`\``;
}

function formatList(items) {
  const normalized = normalizeStringArray(items);
  return normalized.length ? normalized.map((item) => `- ${item}`).join("\n") : "- None";
}
