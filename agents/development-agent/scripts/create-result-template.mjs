#!/usr/bin/env node
import {
  createAgentResultTemplate,
  readJsonFile,
  validateAgentResult,
  writeJsonFile,
} from "./development-agent-lib.mjs";

const [, , workItemPath, outputPath] = process.argv;

if (!workItemPath) {
  console.error("Usage: node agents/development-agent/scripts/create-result-template.mjs <work-item.json> [output.json]");
  process.exit(1);
}

try {
  const workItem = await readJsonFile(workItemPath);
  const resultTemplate = createAgentResultTemplate(workItem);
  const validation = await validateAgentResult(resultTemplate);

  if (!validation.ok) {
    console.error("Generated result template is invalid.");
    console.error(validation.errors.join("\n"));
    process.exit(1);
  }

  if (outputPath) {
    const writtenPath = await writeJsonFile(outputPath, resultTemplate);
    console.log(`OK: result template written to ${writtenPath}`);
  } else {
    console.log(JSON.stringify(resultTemplate, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
