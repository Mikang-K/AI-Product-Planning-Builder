import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(currentDir, "../schemas");
const workItemStatuses = ["draft", "ready", "exported", "in_review", "pass", "needs_revision", "blocked"];
const resultStatuses = ["pass", "needs_revision", "blocked"];
const approvalGates = ["approved", "requires_user_decision"];
const severities = ["critical", "high", "medium", "low", "info"];

export async function readJsonFile(filePath) {
  const absolutePath = resolve(filePath);
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON file: ${absolutePath}\n${error.message}`);
  }
}

export async function writeJsonFile(filePath, value) {
  const absolutePath = resolve(filePath);
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolutePath;
}

export async function validateReviewInput(collaborationPackage, workItem) {
  const [workItemSchema] = await Promise.all([loadSchema("review-work-item.schema.json")]);
  const errors = [
    ...validateCollaborationPackage(collaborationPackage),
    ...validateSchema(workItem, workItemSchema, "workItem"),
    ...validateReviewWorkItem(workItem),
    ...validatePackageWorkItemLink(collaborationPackage, workItem),
  ];
  return { ok: errors.length === 0, errors };
}

export async function validateReviewResult(result) {
  const schema = await loadSchema("review-result.schema.json");
  const errors = [
    ...validateSchema(result, schema, "reviewResult"),
    ...validateFindings(result.findings, "reviewResult.findings"),
    ...validateStringArray(result.recommendedChanges, "reviewResult.recommendedChanges"),
    ...validateStringArray(result.changedFiles, "reviewResult.changedFiles"),
    ...validateStringArray(result.tests, "reviewResult.tests"),
    ...validateStringArray(result.risks, "reviewResult.risks"),
  ];
  return { ok: errors.length === 0, errors };
}

export function createReviewResultTemplate(workItem) {
  if (!workItem || typeof workItem !== "object") throw new Error("Work item must be an object.");
  if (workItem.agentRole !== "reviewer") throw new Error("Only reviewer work items are supported.");
  if (!workItem.id) throw new Error("Work item id is required.");

  return {
    agentRole: "reviewer",
    workItemId: workItem.id,
    status: "blocked",
    findings: [
      {
        severity: "medium",
        file: "",
        line: 1,
        title: `Template created for: ${workItem.title || workItem.id}`,
        description: "Replace this with the concrete review finding.",
        recommendation: "Inspect the linked developer result and run the required checks.",
      },
    ],
    recommendedChanges: ["Review the linked developer work item before approval."],
    changedFiles: [],
    tests: ["No automated tests were run by this template generator."],
    risks: ["No target repository was connected by this template generator."],
    approvalGate: "requires_user_decision",
  };
}

export function formatValidationErrors(errors) {
  return errors.map((error) => `- ${error}`).join("\n");
}

async function loadSchema(fileName) {
  return readJsonFile(resolve(schemasDir, fileName));
}

function validateCollaborationPackage(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["collaborationPackage: must be an object."];
  if (!value.projectId) errors.push("collaborationPackage.projectId: is required.");
  if (!Array.isArray(value.workItems)) errors.push("collaborationPackage.workItems: must be an array.");
  if (!value.handoffInputs || typeof value.handoffInputs !== "object") errors.push("collaborationPackage.handoffInputs: must be an object.");
  return errors;
}

function validateSchema(value, schema, path) {
  const errors = [];
  if (!schema || schema.type !== "object") return [`${path}: unsupported schema.`];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: must be an object.`];
  for (const key of schema.required || []) {
    if (value[key] === undefined || value[key] === null || value[key] === "") errors.push(`${path}.${key}: is required.`);
  }
  for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
    if (value[key] === undefined || value[key] === null) continue;
    const propertyPath = `${path}.${key}`;
    const typeError = validateType(value[key], propertySchema.type, propertyPath);
    if (typeError) errors.push(typeError);
    if (propertySchema.enum && !propertySchema.enum.includes(value[key])) {
      errors.push(`${propertyPath}: must be one of ${propertySchema.enum.join(", ")}.`);
    }
  }
  return errors;
}

function validateType(value, expectedType, path) {
  if (!expectedType) return "";
  if (expectedType === "array" && !Array.isArray(value)) return `${path}: must be an array.`;
  if (expectedType === "object" && (!value || typeof value !== "object" || Array.isArray(value))) return `${path}: must be an object.`;
  if (expectedType !== "array" && expectedType !== "object" && typeof value !== expectedType) return `${path}: must be a ${expectedType}.`;
  return "";
}

function validateReviewWorkItem(workItem) {
  const errors = [];
  if (workItem.agentRole !== "reviewer") errors.push("workItem.agentRole: must be reviewer.");
  if (workItem.status && !workItemStatuses.includes(workItem.status)) {
    errors.push(`workItem.status: must be one of ${workItemStatuses.join(", ")}.`);
  }
  if (!Array.isArray(workItem.acceptanceCriteria) || workItem.acceptanceCriteria.length === 0) {
    errors.push("workItem.acceptanceCriteria: must include at least one item.");
  }
  if (!Array.isArray(workItem.blockedBy) || !workItem.blockedBy.length) {
    errors.push("workItem.blockedBy: must link to a developer work item.");
  }
  return errors;
}

function validatePackageWorkItemLink(collaborationPackage, workItem) {
  if (!Array.isArray(collaborationPackage.workItems)) return ["collaborationPackage.workItems: must be an array."];
  const matchingItem = collaborationPackage.workItems.find((item) => item && item.id === workItem.id);
  if (!matchingItem) return [`collaborationPackage.workItems: missing work item id ${workItem.id}.`];
  return matchingItem.agentRole === workItem.agentRole ? [] : ["collaborationPackage.workItems: matching item agentRole does not match."];
}

function validateFindings(value, path) {
  if (!Array.isArray(value)) return [`${path}: must be an array.`];
  return value.flatMap((item, index) => {
    if (typeof item === "string") return item.trim() ? [] : [`${path}[${index}]: must not be empty.`];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [`${path}[${index}]: must be a string or object.`];
    const errors = [];
    if (item.severity && !severities.includes(item.severity)) errors.push(`${path}[${index}].severity: invalid severity.`);
    if (item.line !== undefined && (!Number.isInteger(Number(item.line)) || Number(item.line) <= 0)) {
      errors.push(`${path}[${index}].line: must be a positive number.`);
    }
    if (!item.title && !item.recommendation && !item.file) errors.push(`${path}[${index}]: needs title, recommendation, or file.`);
    return errors;
  });
}

function validateStringArray(value, path) {
  if (!Array.isArray(value)) return [`${path}: must be an array.`];
  return value.map((item, index) => (typeof item === "string" ? "" : `${path}[${index}]: must be a string.`)).filter(Boolean);
}

export function isValidResultStatus(status) {
  return resultStatuses.includes(status);
}

export function isValidApprovalGate(approvalGate) {
  return approvalGates.includes(approvalGate);
}
