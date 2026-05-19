import {
  buildCollaborationPackage,
  ensureProjectCollaboration,
  normalizeAgentResult,
} from "./collaboration.js";
import { deepClone, id, now } from "./utils.js";

const runnableDeveloperStatuses = ["ready", "exported", "needs_revision"];
const terminalAutomationStatuses = ["completed", "failed", "cancelled"];

export function automationRunStatuses() {
  return ["queued", "running", "completed", "failed", "cancelled"];
}

export function getRunnableDevelopmentWorkItems(project) {
  const collaboration = ensureProjectCollaboration(project);
  return collaboration.workItems.filter(
    (item) =>
      item.agentRole === "developer" &&
      runnableDeveloperStatuses.includes(item.status) &&
      !hasOpenBlocker(collaboration, item),
  );
}

export function createAutomationRun(project, workItemIds, options = {}) {
  const collaboration = ensureAutomationState(project);
  const ids = normalizeWorkItemIds(workItemIds);
  if (!ids.length) {
    throw new Error("At least one work item id is required.");
  }

  const selectedItems = ids.map((workItemId) => findDevelopmentWorkItem(collaboration, workItemId));
  const blockedItem = selectedItems.find((item) => !runnableDeveloperStatuses.includes(item.status));
  if (blockedItem) {
    throw new Error(`Work item ${blockedItem.id} is not runnable from status ${blockedItem.status}.`);
  }
  const createdAt = options.createdAt || now();
  const run = {
    id: options.id || id("automation_run"),
    projectId: project.id,
    agentRole: "developer",
    status: options.status || "queued",
    workItemIds: selectedItems.map((item) => item.id),
    createdAt,
    startedAt: null,
    completedAt: null,
    resultIds: [],
    error: "",
  };

  collaboration.automationRuns.unshift(run);
  selectedItems.forEach((item) => {
    if (options.markWorkItems !== false && (options.workItemStatus || item.status === "ready")) {
      item.status = options.workItemStatus || "exported";
      item.updatedAt = createdAt;
    }
  });
  collaboration.updatedAt = createdAt;
  project.updatedAt = createdAt;
  return run;
}

export function buildDevelopmentAgentInput(project, workItem, run = null) {
  const collaborationPackage = buildCollaborationPackage(project);
  const selectedItem = resolveWorkItem(collaborationPackage.workItems, workItem);
  if (!selectedItem) {
    throw new Error(`Unknown workItemId: ${workItem?.id || workItem}`);
  }
  if (selectedItem.agentRole !== "developer") {
    throw new Error("Only developer work items can be used for development agent input.");
  }

  return {
    collaborationPackage,
    workItem: deepClone(selectedItem),
    run: run
      ? {
          id: run.id,
          projectId: run.projectId,
          workItemIds: [...run.workItemIds],
        }
      : null,
  };
}

export function buildDevelopmentAgentBatch(project, workItems, run = null) {
  const items = workItems.length ? workItems : getRunnableDevelopmentWorkItems(project);
  return {
    projectId: project.id,
    projectTitle: project.title,
    createdAt: now(),
    run: run
      ? {
          id: run.id,
          projectId: run.projectId,
          workItemIds: [...run.workItemIds],
        }
      : null,
    inputs: items.map((item) => buildDevelopmentAgentInput(project, item, run)),
  };
}

export function applyAgentResultToAutomation(project, result, runId = "") {
  const collaboration = ensureAutomationState(project);
  const normalized = normalizeAgentResult(result, collaboration);
  const workItem = collaboration.workItems.find((item) => item.id === normalized.workItemId);
  if (!workItem) {
    throw new Error(`Unknown workItemId: ${normalized.workItemId}`);
  }

  workItem.status = normalized.status;
  workItem.updatedAt = normalized.importedAt;
  collaboration.agentRuns.unshift(normalized);
  updateMatchingAutomationRun(collaboration, normalized, runId);
  collaboration.updatedAt = normalized.importedAt;
  project.updatedAt = normalized.importedAt;

  project.decisionLogs = Array.isArray(project.decisionLogs) ? project.decisionLogs : [];
  project.changeLogs = Array.isArray(project.changeLogs) ? project.changeLogs : [];
  project.decisionLogs.unshift({
    id: id("decision"),
    decision: "Agent result imported",
    reason: `${normalized.agentRole} completed ${normalized.workItemId} with ${normalized.status}.`,
    createdAt: normalized.importedAt,
  });

  if (normalized.recommendedChanges.length) {
    project.changeLogs.unshift({
      id: id("change"),
      changedSection: "Agent Recommendations",
      before: "",
      after: normalized.recommendedChanges.join("\n"),
      reason: `${normalized.workItemId} returned recommendations.`,
      createdAt: normalized.importedAt,
    });
  }

  return normalized;
}

export function buildDevelopmentAgentCliCommand(packageFile = "package.json", workItemFile = "work-item.json", resultFile = "result.json") {
  return [
    `node agents\\development-agent\\scripts\\validate-input.mjs ${packageFile} ${workItemFile}`,
    `node agents\\development-agent\\scripts\\create-result-template.mjs ${workItemFile} ${resultFile}`,
  ].join("\n");
}

function ensureAutomationState(project) {
  const collaboration = ensureProjectCollaboration(project);
  collaboration.automationRuns = Array.isArray(collaboration.automationRuns) ? collaboration.automationRuns : [];
  return collaboration;
}

function normalizeWorkItemIds(workItemIds) {
  return (Array.isArray(workItemIds) ? workItemIds : [workItemIds])
    .map((workItemId) => String(workItemId || "").trim())
    .filter(Boolean);
}

function findDevelopmentWorkItem(collaboration, workItemId) {
  const workItem = collaboration.workItems.find((item) => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Unknown workItemId: ${workItemId}`);
  }
  if (workItem.agentRole !== "developer") {
    throw new Error("Only developer work items can be automated by the development agent.");
  }
  return workItem;
}

function resolveWorkItem(workItems, workItem) {
  const workItemId = typeof workItem === "string" ? workItem : workItem?.id;
  return workItems.find((item) => item.id === workItemId);
}

function hasOpenBlocker(collaboration, workItem) {
  if (!Array.isArray(workItem.blockedBy) || !workItem.blockedBy.length) return false;
  return workItem.blockedBy.some((blockedById) => {
    const blocker = collaboration.workItems.find((item) => item.id === blockedById);
    return !blocker || blocker.status !== "pass";
  });
}

function updateMatchingAutomationRun(collaboration, normalized, runId) {
  const run =
    (runId && collaboration.automationRuns.find((item) => item.id === runId)) ||
    collaboration.automationRuns.find(
      (item) =>
        item.agentRole === normalized.agentRole &&
        item.workItemIds.includes(normalized.workItemId) &&
        !terminalAutomationStatuses.includes(item.status),
    );

  if (!run) return;
  run.resultIds = Array.isArray(run.resultIds) ? run.resultIds : [];
  if (!run.resultIds.includes(normalized.id)) {
    run.resultIds.push(normalized.id);
  }
  run.completedAt = normalized.importedAt;
  run.status = normalized.status === "blocked" ? "failed" : "completed";
  run.error = normalized.status === "blocked" ? normalized.risks.join(" ") || "Development agent result was blocked." : "";
}
