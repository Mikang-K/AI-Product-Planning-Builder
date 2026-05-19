import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(currentDir, "../schemas");

const workItemStatuses = ["draft", "ready", "exported", "in_review", "pass", "needs_revision", "blocked"];
const resultStatuses = ["pass", "needs_revision", "blocked"];
const approvalGates = ["approved", "requires_user_decision"];

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

export async function validateDevelopmentInput(collaborationPackage, workItem) {
  const [packageSchema, workItemSchema] = await Promise.all([
    loadSchema("collaboration-package.schema.json"),
    loadSchema("development-work-item.schema.json"),
  ]);
  const errors = [
    ...validateSchema(collaborationPackage, packageSchema, "collaborationPackage"),
    ...validateSchema(workItem, workItemSchema, "workItem"),
    ...validateDevelopmentWorkItem(workItem),
    ...validatePackageWorkItemLink(collaborationPackage, workItem),
  ];

  return {
    ok: errors.length === 0,
    errors,
  };
}

export async function validateAgentResult(result) {
  const schema = await loadSchema("agent-result.schema.json");
  const errors = [
    ...validateSchema(result, schema, "agentResult"),
    ...validateStringArray(result.findings, "agentResult.findings"),
    ...validateStringArray(result.recommendedChanges, "agentResult.recommendedChanges"),
    ...validateStringArray(result.changedFiles, "agentResult.changedFiles"),
    ...validateStringArray(result.tests, "agentResult.tests"),
    ...validateStringArray(result.risks, "agentResult.risks"),
  ];
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function createAgentResultTemplate(workItem) {
  if (!workItem || typeof workItem !== "object") {
    throw new Error("Work item must be an object.");
  }
  if (workItem.agentRole !== "developer") {
    throw new Error("Only developer work items are supported.");
  }
  if (!workItem.id) {
    throw new Error("Work item id is required.");
  }

  return {
    agentRole: "developer",
    workItemId: workItem.id,
    status: "blocked",
    findings: [`Template created for: ${workItem.title || workItem.id}`],
    recommendedChanges: ["Review the PRD and development package before editing files."],
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

function validateSchema(value, schema, path) {
  const errors = [];
  if (!schema || schema.type !== "object") {
    return [`${path}: unsupported schema.`];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [`${path}: must be an object.`];
  }

  for (const key of schema.required || []) {
    if (value[key] === undefined || value[key] === null || value[key] === "") {
      errors.push(`${path}.${key}: is required.`);
    }
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
  if (expectedType === "array" && !Array.isArray(value)) {
    return `${path}: must be an array.`;
  }
  if (expectedType === "object" && (!value || typeof value !== "object" || Array.isArray(value))) {
    return `${path}: must be an object.`;
  }
  if (expectedType !== "array" && expectedType !== "object" && typeof value !== expectedType) {
    return `${path}: must be a ${expectedType}.`;
  }
  return "";
}

function validateDevelopmentWorkItem(workItem) {
  const errors = [];
  if (workItem.agentRole !== "developer") {
    errors.push("workItem.agentRole: must be developer.");
  }
  if (workItem.status && !workItemStatuses.includes(workItem.status)) {
    errors.push(`workItem.status: must be one of ${workItemStatuses.join(", ")}.`);
  }
  if (!Array.isArray(workItem.acceptanceCriteria) || workItem.acceptanceCriteria.length === 0) {
    errors.push("workItem.acceptanceCriteria: must include at least one item.");
  }
  return errors;
}

function validatePackageWorkItemLink(collaborationPackage, workItem) {
  const errors = [];
  if (!Array.isArray(collaborationPackage.workItems)) {
    return ["collaborationPackage.workItems: must be an array."];
  }
  const matchingItem = collaborationPackage.workItems.find((item) => item && item.id === workItem.id);
  if (!matchingItem) {
    errors.push(`collaborationPackage.workItems: missing work item id ${workItem.id}.`);
    return errors;
  }
  if (matchingItem.agentRole !== workItem.agentRole) {
    errors.push("collaborationPackage.workItems: matching item agentRole does not match.");
  }
  return errors;
}

function validateStringArray(value, path) {
  if (!Array.isArray(value)) return [`${path}: must be an array.`];
  return value
    .map((item, index) => (typeof item === "string" ? "" : `${path}[${index}]: must be a string.`))
    .filter(Boolean);
}

export function isValidResultStatus(status) {
  return resultStatuses.includes(status);
}

export function isValidApprovalGate(approvalGate) {
  return approvalGates.includes(approvalGate);
}
