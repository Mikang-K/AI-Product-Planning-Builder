import test from "node:test";
import assert from "node:assert/strict";

import {
  buildArtifacts,
  buildQualityReport,
  inferProfile,
  normalizeProductArtifacts,
} from "../src/artifacts.js";
import {
  assertMatchesSchema,
  developmentPackageSchema,
  productPackageSchema,
  validationPackageSchema,
} from "../src/schemas.js";

test("buildArtifacts creates schema-compatible planning artifacts", () => {
  const artifacts = buildArtifacts("AI tool for planning small product ideas", inferProfile("planning tool"));

  assertMatchesSchema(artifacts, productPackageSchema(), "Product Package");
  assertMatchesSchema(artifacts.development, developmentPackageSchema(), "Development Package");
  assertMatchesSchema(artifacts.validation, validationPackageSchema(), "Validation Package");
  assert.equal(typeof artifacts.prd, "string");
  assert.ok(artifacts.prd.length > 100);
  assert.equal(artifacts.agentPackage.agents.length, 3);
});

test("normalizeProductArtifacts falls back when LLM output is malformed", () => {
  const fallback = buildArtifacts("AI tool for planning small product ideas", inferProfile("planning tool"));
  const normalized = normalizeProductArtifacts(
    {
      analysis: { targetUser: "Specific user group" },
      questions: [{ question: "only one", reason: "not enough" }],
      assumptions: [],
      mvp: { included: [], excluded: [] },
      metrics: ["one"],
      prd: "",
    },
    fallback,
  );

  assert.equal(normalized.analysis.targetUser, "Specific user group");
  assert.deepEqual(normalized.questions, fallback.questions);
  assert.deepEqual(normalized.assumptions, fallback.assumptions);
  assert.deepEqual(normalized.mvp, fallback.mvp);
  assert.deepEqual(normalized.metrics, fallback.metrics);
  assert.equal(normalized.development, null);
  assert.equal(normalized.validation, null);
});

test("buildQualityReport reports a bounded score for generated artifacts", () => {
  const artifacts = buildArtifacts("AI tool for planning small product ideas", inferProfile("planning tool"));
  const quality = buildQualityReport(artifacts);

  assert.equal(typeof quality.score, "number");
  assert.ok(quality.score >= 0);
  assert.ok(quality.score <= 100);
  assert.equal(quality.fieldChecks.length > 0, true);
  assert.equal(Array.isArray(quality.schemaChecks), true);
});
