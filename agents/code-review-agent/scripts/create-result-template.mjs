#!/usr/bin/env node
import {
  createReviewResultTemplate,
  readJsonFile,
  validateReviewResult,
  writeJsonFile,
} from "./code-review-agent-lib.mjs";

const [, , workItemPath, outputPath] = process.argv;

if (!workItemPath) {
  console.error("Usage: node agents/code-review-agent/scripts/create-result-template.mjs <review-work-item.json> [output.json]");
  process.exit(1);
}

try {
  const workItem = await readJsonFile(workItemPath);
  const resultTemplate = createReviewResultTemplate(workItem);
  const validation = await validateReviewResult(resultTemplate);

  if (!validation.ok) {
    console.error("Generated review result template is invalid.");
    console.error(validation.errors.join("\n"));
    process.exit(1);
  }

  if (outputPath) {
    const writtenPath = await writeJsonFile(outputPath, resultTemplate);
    console.log(`OK: review result template written to ${writtenPath}`);
  } else {
    console.log(JSON.stringify(resultTemplate, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
