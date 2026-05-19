import test from "node:test";
import assert from "node:assert/strict";

import { assertMatchesSchema, productPackageSchema, validationPackageSchema } from "../src/schemas.js";

test("product package schema accepts a minimal valid package", () => {
  assert.doesNotThrow(() =>
    assertMatchesSchema(
      {
        analysis: {},
        questions: [{}, {}, {}],
        assumptions: [{}, {}, {}],
        mvp: { included: [], excluded: [] },
        scenario: {},
        metrics: ["a", "b", "c"],
        experiment: {},
        prd: "PRD",
      },
      productPackageSchema(),
      "Product Package",
    ),
  );
});

test("validation package schema rejects missing risk items", () => {
  assert.throws(
    () =>
      assertMatchesSchema(
        {
          prdScore: 90,
          summary: "ok",
          mvpFit: {},
          risks: [],
          experimentReview: [],
          launchChecklist: ["a", "b", "c"],
          recommendations: [],
        },
        validationPackageSchema(),
        "Validation Package",
      ),
    /risks/,
  );
});
