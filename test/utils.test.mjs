import test from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, slugify } from "../src/utils.js";

test("escapeHtml escapes unsafe HTML characters", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')">`), "&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt;");
});

test("slugify keeps Korean text and removes unsafe filename characters", () => {
  assert.equal(slugify("AI 제품 기획: MVP/검증!"), "ai-제품-기획-mvp-검증");
});
