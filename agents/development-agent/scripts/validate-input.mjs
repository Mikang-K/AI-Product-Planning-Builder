#!/usr/bin/env node
import {
  formatValidationErrors,
  readJsonFile,
  validateDevelopmentInput,
} from "./development-agent-lib.mjs";

const [, , packagePath, workItemPath] = process.argv;

if (!packagePath || !workItemPath) {
  console.error("Usage: node agents/development-agent/scripts/validate-input.mjs <collaboration-package.json> <work-item.json>");
  process.exit(1);
}

try {
  const [collaborationPackage, workItem] = await Promise.all([
    readJsonFile(packagePath),
    readJsonFile(workItemPath),
  ]);
  const result = await validateDevelopmentInput(collaborationPackage, workItem);

  if (!result.ok) {
    console.error("FAIL: development agent input is invalid.");
    console.error(formatValidationErrors(result.errors));
    process.exit(1);
  }

  console.log("OK: development agent input is valid.");
  console.log(`Project: ${collaborationPackage.projectTitle || collaborationPackage.projectId}`);
  console.log(`Work item: ${workItem.id} (${workItem.status})`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
