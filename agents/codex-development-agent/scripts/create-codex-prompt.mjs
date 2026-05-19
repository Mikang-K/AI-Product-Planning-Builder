#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildCodexPrompt } from "../../../src/codexWorkflow.js";

const [, , packagePath, outputPath] = process.argv;

if (!packagePath) {
  console.error("Usage: node agents/codex-development-agent/scripts/create-codex-prompt.mjs <codex-package.json> [output.md]");
  process.exit(1);
}

try {
  const codexPackage = JSON.parse(await readFile(resolve(packagePath), "utf8"));
  const prompt = buildCodexPrompt(codexPackage);
  if (outputPath) {
    const absoluteOutputPath = resolve(outputPath);
    await writeFile(absoluteOutputPath, prompt, "utf8");
    console.log(`OK: Codex prompt written to ${absoluteOutputPath}`);
  } else {
    console.log(prompt);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
