# Refactoring Plan

## 1. Goal

Refactor the current browser-only Product Builder without changing user-facing behavior.

The main goals are:

- Split the large `app.js` file into focused modules.
- Separate pure product-planning logic from DOM rendering.
- Make artifact generation, schema validation, import/export, and collaboration logic testable.
- Prepare the project for a future server API and persistent database.
- Keep the static app usable during the transition.

## 2. Current State

The current implementation is concentrated in:

```text
index.html
styles.css
app.js
```

`app.js` currently owns:

- App state
- DOM element caching
- Event binding
- Rendering
- Local planning engine
- LLM client and LLM orchestration
- Artifact normalization
- Schema validation
- PRD generation
- Quality report generation
- Project import/export
- Feedback updates
- Version comparison
- Agent Package generation
- Agent Collaboration Board
- Agent result import

This is workable for a prototype, but it is becoming difficult to test, extend, and safely modify.

## 3. Target Structure

Use ES Modules first. Avoid adding a bundler in the first refactor unless a later step needs package dependencies.

Recommended target:

```text
src/
  main.js
  state.js
  dom.js

  render/
    projectList.js
    workspace.js
    tabs.js
    artifacts.js
    collaboration.js

  engines/
    plannerEngine.js
    llmClient.js
    llmEngine.js

  artifacts/
    buildProduct.js
    development.js
    validation.js
    agentPackage.js
    normalize.js
    schemas.js
    quality.js
    prd.js

  collaboration/
    workItems.js
    package.js
    agentResults.js

  storage/
    localStorageStore.js
    importExport.js

  utils/
    date.js
    html.js
    ids.js
    text.js
```

For the first MVP refactor, use a smaller split:

```text
src/
  main.js
  utils.js
  storage.js
  schemas.js
  artifacts.js
  collaboration.js
```

## 4. Refactoring Principles

- Preserve behavior first.
- Move pure functions before moving DOM code.
- Avoid changing UI and module boundaries in the same step.
- Keep `index.html` loading one app entrypoint.
- Use named exports for testable functions.
- Keep migration logic backward compatible with existing `localStorage` projects.
- Avoid broad rewrites of CSS unless the rendered structure changes.

## 5. Pure Logic To Extract First

Move these functions out of `app.js` before touching renderers:

- `buildArtifacts`
- `buildDevelopmentPackage`
- `buildValidationPackage`
- `buildAgentPackage`
- `buildQualityReport`
- `buildPrd`
- `normalizeProductArtifacts`
- `normalizeDevelopmentPackage`
- `normalizeValidationPackage`
- `assertMatchesSchema`
- `validateSchemaValue`
- `productPackageSchema`
- `developmentPackageSchema`
- `validationPackageSchema`
- `buildCollaborationPackage`
- `buildDevelopmentWorkItems`
- `buildValidationWorkItems`
- `mergeGeneratedWorkItems`
- `normalizeAgentResult`
- `slugify`
- `escapeHtml`
- `formatDate`
- `id`
- `deepClone`

## 6. DOM Logic To Keep Near Main Initially

Keep these in `main.js` during the first pass:

- `cacheElements`
- `bindEvents`
- `render`
- `renderProjectList`
- `renderWorkspace`
- `renderTabs`
- `renderTabContent`
- `attachFeedbackForm`
- `attachQuestionAnswerForm`
- `attachCollaborationBoard`
- export button wiring
- import input wiring

After the pure logic split is stable, move renderers into `src/render/`.

## 7. State Update Refactor

Replace scattered direct mutations with action functions.

Target actions:

```js
createProjectFromIdea(idea)
selectProject(projectId)
renameProject(projectId, title)
duplicateProject(projectId)
deleteProject(projectId)
applyFeedback(projectId, feedback)
importProjectJson(payload)
importAgentResult(projectId, result)
updateWorkItemStatus(projectId, workItemId, status)
```

Each action should be responsible for:

- Updating state
- Updating timestamps
- Running migrations when needed
- Saving state
- Returning enough information for the UI to re-render

This prepares the app for replacing `localStorage` with a server API later.

## 8. Schema Validation Plan

Current validation is intentionally lightweight. Refactor it into `src/schemas.js`.

First pass:

- Keep the current internal schema validator.
- Add schema definitions for Agent Result and Work Item.
- Validate project import payloads.
- Validate collaboration package export shape.

Future pass:

- Add Ajv or another JSON Schema validator.
- Move schemas closer to standard JSON Schema draft syntax.
- Add detailed user-facing error messages.

## 9. Rendering Refactor Plan

Once pure logic is separated, move renderer groups in this order:

1. `renderProjectList`
2. `renderTabs`
3. artifact renderers:
   - `renderDiagnosis`
   - `renderQuestions`
   - `renderAssumptions`
   - `renderMvp`
   - `renderScenario`
   - `renderExperiment`
   - `renderPrd`
   - `renderDevelopment`
   - `renderValidation`
   - `renderQuality`
4. `renderAgentPackage`
5. `renderCollaborationBoard`
6. `renderLogs`
7. `renderHistory`

Create shared rendering helpers:

- `renderPanel`
- `renderList`
- `renderTable`
- `renderDefinitionList`
- `renderStatusPill`
- `renderCodeBlock`

## 10. Storage Refactor Plan

Move persistence to `src/storage.js`.

Functions:

```js
loadStateFromStorage()
saveStateToStorage(state)
sanitizePersistedLlmConfig(config)
normalizeImportedProjects(payload, existingProjects)
normalizeImportedProject(project, existingIds)
```

Important requirement:

- Continue excluding `llmConfig.apiKey` from `localStorage`.

## 11. Engine Refactor Plan

Move engines after artifact and schema modules are stable.

Modules:

```text
src/engines/plannerEngine.js
src/engines/llmClient.js
src/engines/llmEngine.js
```

Keep endpoint allowlist in the LLM client module.

The LLM engine should depend on:

- schemas
- artifact normalization
- artifact builders
- PRD builder
- agent package builder
- quality builder

## 12. Collaboration Refactor Plan

Move collaboration logic to `src/collaboration.js` in the first MVP split.

Functions:

- `ensureProjectCollaboration`
- `buildCollaborationPackage`
- `buildDevelopmentWorkItems`
- `buildValidationWorkItems`
- `mergeGeneratedWorkItems`
- `workItemStatuses`
- `workItemStatusLabel`
- `workItemStatusClass`
- `normalizeAgentResult`

Later split:

```text
src/collaboration/workItems.js
src/collaboration/package.js
src/collaboration/agentResults.js
```

## 13. Encoding Cleanup

Several user-facing Korean strings in `app.js`, `index.html`, and older planning docs appear mojibake-corrupted.

Cleanup targets:

- `index.html`
- `app.js`
- `docs/plan/AI-product-planning-agent.md`

Approach:

- Do not mix encoding cleanup with behavior refactors.
- Fix UI-facing strings in one dedicated pass.
- Leave old planning document history intact unless rewriting the full document.

## 14. Test Plan

Add a minimal test setup with Node's built-in `node:test`.

Suggested tests:

- `buildArtifacts()` returns required Product Package fields.
- `normalizeProductArtifacts()` uses fallback for malformed LLM output.
- `assertMatchesSchema()` rejects missing required fields.
- `buildDevelopmentWorkItems()` creates stable IDs.
- `mergeGeneratedWorkItems()` preserves existing status.
- `normalizeAgentResult()` rejects unknown `workItemId`.
- `normalizeAgentResult()` updates valid pass/blocked results.
- `slugify()` creates safe export filenames.
- `sanitizePersistedLlmConfig()` removes `apiKey`.

Example command:

```powershell
node --test
```

Keep `node --check src/main.js` as a quick syntax check.

## 15. Step-By-Step Execution Plan

### Step 1. Prepare ES Module Entry

- Create `src/main.js`.
- Move current `app.js` content into `src/main.js`.
- Change `index.html` script tag to:

```html
<script type="module" src="src/main.js"></script>
```

- Keep old `app.js` temporarily until the new entrypoint works.

### Step 2. Extract Utilities

Create `src/utils.js`.

Move:

- `escapeHtml`
- `formatDate`
- `now`
- `id`
- `slugify`
- `deepClone`
- `containsAny`
- `prioritizeMetric`

Update imports in `main.js`.

### Step 3. Extract Schemas

Create `src/schemas.js`.

Move:

- package schema functions
- schema validator
- field/array check helpers if needed

### Step 4. Extract Artifacts

Create `src/artifacts.js`.

Move:

- product artifact builders
- development package builder
- validation package builder
- agent package builder
- quality builder
- PRD builder
- normalization helpers

### Step 5. Extract Collaboration

Create `src/collaboration.js`.

Move collaboration functions and update imports.

### Step 6. Extract Storage

Create `src/storage.js`.

Move:

- load state
- save state
- project import normalization
- JSON download helpers if they remain storage-related

### Step 7. Add Tests

Create:

```text
test/
  artifacts.test.js
  schemas.test.js
  collaboration.test.js
  storage.test.js
```

Add tests for the pure modules.

### Step 8. Remove Old `app.js`

After the module entrypoint and tests pass:

- Delete or archive `app.js`.
- Ensure `index.html` only references `src/main.js`.

## 16. Verification Checklist

Run:

```powershell
node --check src/main.js
node --test
```

Manual smoke checks:

- Create a project with local engine.
- Switch tabs and confirm all artifact sections render.
- Answer question prompts and confirm version update.
- Rename, duplicate, delete a project.
- Export and import project JSON.
- Export PRD Markdown.
- Export Prompt JSON.
- Open Agent Collaboration Board.
- Export full collaboration package.
- Import valid agent result JSON.
- Confirm work item status and logs update.
- Confirm API Key is not persisted after reload.

## 17. Risks

- Moving functions too quickly can break closure dependencies.
- ES module import cycles may appear between artifact and collaboration modules.
- Renderer extraction can create many small files without improving clarity if done too early.
- Existing localStorage data must remain readable after the split.
- Encoding cleanup can create noisy diffs if mixed with logic changes.

## 18. Recommended First Refactor Scope

Recommended first implementation:

```text
app.js -> src/main.js
src/utils.js
src/schemas.js
src/collaboration.js
```

Do not move renderers in the first pass unless the initial split is stable.

This gives immediate benefits:

- collaboration logic becomes testable
- schemas become reusable
- utilities become centralized
- main app file gets smaller without a risky full rewrite

## 19. First Refactor Pass Status

Completed in the first implementation pass:

- Created `src/main.js` as the ES module app entrypoint.
- Updated `index.html` to load `src/main.js` with `type="module"`.
- Extracted shared utility functions into `src/utils.js`.
- Extracted package schema definitions and lightweight schema validation into `src/schemas.js`.
- Kept `app.js` as a legacy pre-refactor snapshot until browser smoke verification is completed.
- Verified syntax with:

```powershell
node --check src/main.js
node --check src/utils.js
node --check src/schemas.js
```

Recommended next pass:

1. Extract collaboration logic into `src/collaboration.js`.
2. Add `node:test` coverage for `src/utils.js` and `src/schemas.js`.
3. Run browser smoke verification.
4. Remove the legacy `app.js` snapshot after verification.

## 20. Second Refactor Pass Status

Completed in the second implementation pass:

- Extracted collaboration work item generation, package building, status helpers, and agent result normalization into `src/collaboration.js`.
- Kept collaboration board rendering and DOM event binding in `src/main.js`.
- Added focused `node:test` coverage:
  - `test/utils.test.mjs`
  - `test/schemas.test.mjs`
  - `test/collaboration.test.mjs`
- Verified collaboration behavior for:
  - stable development work item IDs
  - status preservation during generated work item merges
  - collaboration migration/default creation
  - collaboration package handoff inputs
  - valid and invalid agent result imports
- Verified syntax and tests with:

```powershell
node --check src/main.js
node --check src/collaboration.js
node --test
```

Recommended next pass:

1. Extract storage and import/export logic into `src/storage.js`.
2. Add tests for API key persistence sanitization and project JSON import.
3. Run browser smoke verification.
4. Remove the legacy `app.js` snapshot after verification.

## 21. Third Refactor Pass Status

Completed in the third implementation pass:

- Extracted persistence helpers into `src/storage.js`.
- Moved API key persistence sanitization into a testable helper.
- Moved project import normalization into `src/storage.js`.
- Moved JSON/text download helpers into `src/storage.js`.
- Kept artifact migration in `src/main.js` because it depends on artifact builders that have not been extracted yet.
- Added storage tests in `test/storage.test.mjs`.
- Verified:
  - persisted LLM config never includes `apiKey`
  - reading persisted state never restores `apiKey`
  - imported projects receive new IDs
  - imported projects receive default version history
  - invalid project JSON is rejected

Verification commands:

```powershell
node --check src/main.js
node --check src/storage.js
node --test
```

Current test count:

```text
15 passing
```

Recommended next pass:

1. Extract artifact builders and normalization into `src/artifacts.js`.
2. Move `migrateProjectArtifacts()` after artifact extraction.
3. Add tests for artifact fallback and quality report generation.
4. Run browser smoke verification.
