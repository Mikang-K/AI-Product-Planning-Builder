import test from "node:test";
import assert from "node:assert/strict";

import { formatFindingText, normalizeFindings } from "../src/findings.js";

test("normalizeFindings preserves strings and structured findings", () => {
  const findings = normalizeFindings([
    "Plain finding",
    {
      severity: "HIGH",
      path: "src/main.js",
      line: "42",
      summary: "Missing save",
      detail: "The state change is not persisted.",
      recommendedChange: "Call saveState after the update.",
    },
  ]);

  assert.equal(findings[0], "Plain finding");
  assert.deepEqual(findings[1], {
    severity: "high",
    title: "Missing save",
    recommendation: "Call saveState after the update.",
    file: "src/main.js",
    line: 42,
    description: "The state change is not persisted.",
  });
});

test("formatFindingText renders structured findings as a compact review line", () => {
  assert.equal(
    formatFindingText({
      severity: "high",
      file: "src/main.js",
      line: 42,
      title: "Missing save",
      recommendation: "Call saveState.",
    }),
    "[high] src/main.js:42 Missing save Recommendation: Call saveState.",
  );
});
