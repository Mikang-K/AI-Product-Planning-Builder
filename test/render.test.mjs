import test from "node:test";
import assert from "node:assert/strict";

import { renderProjectListHtml } from "../src/render/projectList.js";
import { renderTabsHtml } from "../src/render/tabs.js";

test("renderProjectListHtml escapes project data and marks active project", () => {
  const html = renderProjectListHtml(
    [
      {
        id: "project_1",
        title: "<Bad>",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    "project_1",
  );

  assert.match(html, /active/);
  assert.match(html, /&lt;Bad&gt;/);
  assert.match(html, /data-project-id="project_1"/);
});

test("renderProjectListHtml renders an empty state", () => {
  assert.match(renderProjectListHtml([], null), /project-description/);
});

test("renderTabsHtml escapes labels and marks active tab", () => {
  const html = renderTabsHtml(
    [
      { id: "diagnosis", label: "Diagnosis" },
      { id: "bad", label: "<Bad>" },
    ],
    "bad",
  );

  assert.match(html, /data-tab-id="bad"/);
  assert.match(html, /&lt;Bad&gt;/);
  assert.match(html, /active/);
});
