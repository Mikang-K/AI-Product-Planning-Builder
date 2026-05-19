import { deepClone, id, now } from "./utils.js";

export function ensureProjectCollaboration(project) {
  project.collaboration ||= {};
  project.collaboration.workItems = mergeGeneratedWorkItems(
    Array.isArray(project.collaboration.workItems) ? project.collaboration.workItems : [],
    [...buildDevelopmentWorkItems(project), ...buildValidationWorkItems(project)],
  );
  project.collaboration.agentRuns = Array.isArray(project.collaboration.agentRuns) ? project.collaboration.agentRuns : [];
  project.collaboration.approvals = Array.isArray(project.collaboration.approvals) ? project.collaboration.approvals : [];
  project.collaboration.updatedAt ||= project.updatedAt || now();
  return project.collaboration;
}

export function buildCollaborationPackage(project) {
  const collaboration = ensureProjectCollaboration(project);
  const artifacts = project.artifacts;
  return {
    projectId: project.id,
    projectTitle: project.title,
    exportedAt: now(),
    projectContext: {
      summary: artifacts.analysis?.oneLineDescription,
      targetUser: artifacts.analysis?.targetUser,
      problem: artifacts.analysis?.problem,
      valueProposition: artifacts.analysis?.valueProposition,
      mvpScope: artifacts.mvp?.included?.map((feature) => feature.name) || [],
    },
    handoffInputs: {
      prd: artifacts.prd,
      development: artifacts.development,
      validation: artifacts.validation,
      decisionLogs: project.decisionLogs || [],
    },
    workItems: collaboration.workItems,
    agentRuns: collaboration.agentRuns,
    approvals: collaboration.approvals,
    reviewChecklist: [
      "Confirm any MVP scope changes before applying them.",
      "Confirm API spec changes before implementation starts.",
      "Review validation findings marked requires_user_decision.",
    ],
  };
}

export function buildDevelopmentWorkItems(project) {
  const artifacts = project.artifacts || {};
  const tasks = artifacts.development?.tasks || [];
  return tasks.map((task, index) => ({
    id: `work_dev_${index + 1}`,
    agentRole: "developer",
    source: "development.tasks",
    title: task.title || `Development task ${index + 1}`,
    description: task.reason || "Implement the assigned development work item.",
    status: "ready",
    priority: task.priority || "medium",
    inputArtifacts: ["prd", "development.apiSpec", "development.dataModels", "development.tasks"],
    acceptanceCriteria: [
      "Implementation follows the generated PRD and development package.",
      "Changed files and verification steps are reported.",
      "Risks or blockers are explicitly listed.",
    ],
    blockedBy: [],
    expectedOutput: {
      changedFiles: [],
      summary: "string",
      tests: [],
      risks: [],
    },
    createdAt: project.createdAt || now(),
    updatedAt: project.updatedAt || now(),
  }));
}

export function buildValidationWorkItems(project) {
  const validation = project.artifacts?.validation || {};
  const risks = validation.risks || [];
  const riskItems = risks.map((risk, index) => ({
    id: `work_val_risk_${index + 1}`,
    agentRole: "validator",
    source: "validation.risks",
    title: risk.title || `Validate risk ${index + 1}`,
    description: risk.mitigation || risk.reason || "Review the product risk and propose concrete changes.",
    status: "ready",
    priority: risk.severity || "medium",
    inputArtifacts: ["prd", "validation.risks", "validation.mvpFit", "validation.experimentReview"],
    acceptanceCriteria: [
      "Findings identify whether the risk is acceptable for MVP.",
      "Recommended changes are concrete and traceable to the PRD.",
      "Approval gate is marked approved or requires_user_decision.",
    ],
    blockedBy: [],
    expectedOutput: {
      agentRole: "validator",
      workItemId: "string",
      status: "pass|needs_revision|blocked",
      findings: [],
      recommendedChanges: [],
      approvalGate: "approved|requires_user_decision",
    },
    createdAt: project.createdAt || now(),
    updatedAt: project.updatedAt || now(),
  }));

  return [
    ...riskItems,
    {
      id: "work_val_launch_checklist",
      agentRole: "validator",
      source: "validation.launchChecklist",
      title: "Review launch readiness checklist",
      description: "Check whether the launch checklist is complete enough for an MVP handoff.",
      status: "ready",
      priority: "medium",
      inputArtifacts: ["prd", "validation.launchChecklist", "quality"],
      acceptanceCriteria: [
        "Checklist gaps are listed as findings.",
        "Recommended changes are grouped by launch risk.",
        "Approval gate is set based on unresolved risk.",
      ],
      blockedBy: [],
      expectedOutput: {
        agentRole: "validator",
        workItemId: "work_val_launch_checklist",
        status: "pass|needs_revision|blocked",
        findings: [],
        recommendedChanges: [],
        approvalGate: "approved|requires_user_decision",
      },
      createdAt: project.createdAt || now(),
      updatedAt: project.updatedAt || now(),
    },
  ];
}

export function mergeGeneratedWorkItems(existingItems, generatedItems) {
  const generatedIds = new Set(generatedItems.map((item) => item.id));
  const existingById = new Map(existingItems.map((item) => [item.id, item]));
  const merged = generatedItems.map((item) => {
    const existing = existingById.get(item.id);
    if (!existing) return item;
    return {
      ...item,
      status: existing.status || item.status,
      createdAt: existing.createdAt || item.createdAt,
      updatedAt: existing.updatedAt || item.updatedAt,
    };
  });
  const customItems = existingItems.filter((item) => item.id && !generatedIds.has(item.id));
  return [...merged, ...customItems];
}

export function workItemStatuses() {
  return ["draft", "ready", "exported", "in_review", "pass", "needs_revision", "blocked"];
}

export function workItemStatusLabel(status) {
  return (
    {
      draft: "Draft",
      ready: "Ready",
      exported: "Exported",
      in_review: "In Review",
      pass: "Pass",
      needs_revision: "Needs Revision",
      blocked: "Blocked",
    }[status] || status
  );
}

export function workItemStatusClass(status) {
  if (status === "pass") return "included";
  if (status === "blocked" || status === "needs_revision") return "excluded";
  return "medium";
}

export function normalizeAgentResult(result, collaboration) {
  if (!result || typeof result !== "object") {
    throw new Error("Agent result must be an object.");
  }
  const agentRole = String(result.agentRole || "").trim();
  const workItemId = String(result.workItemId || "").trim();
  const status = String(result.status || "").trim();
  if (!["developer", "validator"].includes(agentRole)) {
    throw new Error("agentRole must be developer or validator.");
  }
  if (!workItemStatuses().includes(status) || !["pass", "needs_revision", "blocked"].includes(status)) {
    throw new Error("status must be pass, needs_revision, or blocked.");
  }
  const workItem = collaboration.workItems.find((item) => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Unknown workItemId: ${workItemId}`);
  }
  if (workItem.agentRole !== agentRole) {
    throw new Error("agentRole does not match the work item role.");
  }
  const importedAt = now();
  const normalized = {
    id: id("agent_run"),
    workItemId,
    agentRole,
    status,
    findings: normalizeStringArray(result.findings),
    recommendedChanges: normalizeStringArray(result.recommendedChanges),
    changedFiles: normalizeStringArray(result.changedFiles),
    tests: normalizeStringArray(result.tests),
    risks: normalizeStringArray(result.risks),
    approvalGate: ["approved", "requires_user_decision"].includes(result.approvalGate) ? result.approvalGate : "approved",
    importedAt,
  };
  if (result.codexEvidence && typeof result.codexEvidence === "object" && !Array.isArray(result.codexEvidence)) {
    normalized.codexEvidence = deepClone(result.codexEvidence);
  }
  return normalized;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}
