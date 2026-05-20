#!/usr/bin/env node
import {
  formatValidationErrors,
  readJsonFile,
  validateReviewInput,
} from "./code-review-agent-lib.mjs";

const [, , packagePath, workItemPath] = process.argv;

if (!packagePath || !workItemPath) {
  console.error("Usage: node agents/code-review-agent/scripts/validate-input.mjs <collaboration-package.json> <review-work-item.json>");
  process.exit(1);
}

try {
  const [collaborationPackage, workItem] = await Promise.all([
    readJsonFile(packagePath),
    readJsonFile(workItemPath),
  ]);
  const result = await validateReviewInput(collaborationPackage, workItem);

  if (!result.ok) {
    console.error("FAIL: code review agent input is invalid.");
    console.error(formatValidationErrors(result.errors));
    process.exit(1);
  }

  console.log("OK: code review agent input is valid.");
  console.log(`Project: ${collaborationPackage.projectTitle || collaborationPackage.projectId}`);
  console.log(`Review work item: ${workItem.id} (${workItem.status})`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
