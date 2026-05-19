#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeCodexResult } from "../../../src/codexWorkflow.js";

const [, , resultPath] = process.argv;

if (!resultPath) {
  console.error("Usage: node agents/codex-development-agent/scripts/validate-codex-result.mjs <codex-result.json>");
  process.exit(1);
}

try {
  const result = JSON.parse(await readFile(resolve(resultPath), "utf8"));
  const normalized = normalizeCodexResult(result);
  console.log("OK: Codex result is valid.");
  console.log(`Work item: ${normalized.workItemId}`);
  console.log(`Status: ${normalized.status}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
