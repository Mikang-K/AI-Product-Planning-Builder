# AI Product Planning Builder

아이디어를 PRD, 개발 작업, Codex 실행, 코드 리뷰, 검증 결과 반영까지 연결하는 브라우저 기반 Product Builder입니다.

단순한 PRD 생성기가 아니라, 제품 기획 산출물을 개발 가능한 work item으로 분해하고, Codex 실행 결과와 코드 리뷰 결과를 다시 Collaboration Board에 반영하는 로컬 에이전트 워크플로우 도구입니다.

## Portfolio Summary

| 항목 | 내용 |
| --- | --- |
| 프로젝트 유형 | AI 기반 제품 기획 및 개발 에이전트 워크플로우 빌더 |
| 핵심 목표 | 제품 아이디어를 실행 가능한 개발/검증/리뷰 작업으로 전환 |
| 구현 범위 | 기획 산출물 생성, PRD 생성, work item 관리, Codex handoff, runner 실행, 결과 import, 코드 리뷰 에이전트 |
| 기술 스택 | HTML, CSS, Vanilla JavaScript ES Modules, Node.js |
| 저장 방식 | Browser localStorage |
| 테스트 | Node built-in test runner |
| 현재 테스트 | 70 passing |
| 실행 방식 | 정적 UI 또는 Node 기반 Local Runner |

## Problem

초기 제품 아이디어는 보통 다음 단계로 넘어가며 맥락이 손실됩니다.

- 기획 문서는 개발 작업으로 잘게 나뉘지 않는다.
- PRD, 개발 태스크, 검증 기준, 리뷰 결과가 서로 분리되어 관리된다.
- Codex 같은 개발 에이전트에 넘길 때 필요한 입력 계약이 매번 새로 작성된다.
- 개발 결과가 다시 기획/검증 보드로 반영되지 않는다.
- 코드 리뷰 결과가 구조화되지 않아 후속 수정 상태를 추적하기 어렵다.

이 프로젝트는 이 흐름을 하나의 브라우저 앱 안에서 연결하는 것을 목표로 합니다.

## Solution

```text
Idea
  -> Product Planning Artifacts
  -> Development / Validation / Review Work Items
  -> Codex Development or Review Package
  -> Local Codex Runner
  -> Agent Result JSON
  -> Collaboration Board Update
```

사용자는 아이디어를 입력하고, 앱은 다음 산출물을 생성합니다.

- Product Package
- PRD Markdown
- Development Package
- Validation Package
- Agent Package
- Agent Collaboration Board
- Codex Development Package
- Codex Review Package

## Key Features

### 1. Product Planning

제품 아이디어를 구조화된 기획 산출물로 변환합니다.

- 아이디어 진단
- 보완 질문
- 핵심 가정
- MVP 범위
- 사용자 시나리오
- 실험 계획
- PRD 생성
- 품질 리포트 생성

LLM API를 사용할 수 있으며, 실패 시 로컬 `PlannerEngine`으로 fallback합니다.

### 2. Development Work Item

Development Package를 기반으로 개발 작업을 생성합니다.

- 안정적인 work item ID 생성
- 개발 태스크별 acceptance criteria 제공
- 개발 agent 입력 패키지 생성
- Codex 개발 패키지 및 프롬프트 생성
- 개발 결과 import

예시 work item:

```json
{
  "id": "work_dev_1",
  "agentRole": "developer",
  "status": "ready",
  "source": "development.tasks",
  "acceptanceCriteria": [
    "Implementation follows the generated PRD and development package.",
    "Changed files and verification steps are reported.",
    "Risks or blockers are explicitly listed."
  ]
}
```

### 3. Code Review Agent

개발 결과를 검토하는 별도 `reviewer` 역할을 추가했습니다.

개발 work item마다 연결된 review work item이 생성됩니다.

```text
work_dev_1
  -> work_review_dev_1
```

상태 연동:

```text
developer pass
  -> linked review item ready

reviewer needs_revision
  -> linked developer item needs_revision
```

리뷰 결과는 문자열뿐 아니라 구조화된 finding을 지원합니다.

```json
{
  "severity": "high",
  "file": "src/example.js",
  "line": 12,
  "title": "Missing regression test",
  "description": "The changed behavior is not covered.",
  "recommendation": "Add a focused test before approval."
}
```

UI에서는 severity badge, file:line, title, description, recommendation으로 분리해 표시합니다.

### 4. Validation Work Item

제품/기획 관점의 검증 work item도 함께 생성합니다.

- 리스크 검토
- MVP 적정성 검토
- 출시 체크리스트 검토
- 사용자 의사결정이 필요한 항목 표시

`validator`는 제품 검증 역할, `reviewer`는 코드 검토 역할로 분리했습니다.

### 5. Codex Runner

Node 기반 Local Runner가 Codex CLI 실행을 연결합니다.

```text
Product Builder UI
  -> POST /api/codex-runs
  -> agents/runner/server.mjs
  -> codex exec
  -> .agent-runs/<runId>/result.json
  -> Product Builder auto import
```

지원 package type:

- `codex-development`
- `codex-review`

Runner가 없거나 실행할 수 없는 경우에는 prompt markdown 다운로드로 fallback합니다.

### 6. Result Import

Agent Result JSON을 import하면 Collaboration Board가 갱신됩니다.

반영 항목:

- work item status
- agentRuns
- automationRuns
- reviewAutomationRuns
- decisionLogs
- changeLogs
- codexEvidence

예시:

```json
{
  "agentRole": "reviewer",
  "workItemId": "work_review_dev_1",
  "status": "needs_revision",
  "findings": [
    {
      "severity": "high",
      "file": "src/main.js",
      "line": 42,
      "title": "Missing state persistence",
      "recommendation": "Call saveState after the status update."
    }
  ],
  "recommendedChanges": ["Add regression coverage."],
  "changedFiles": [],
  "tests": ["node --test"],
  "risks": [],
  "approvalGate": "requires_user_decision"
}
```

## Architecture

```text
index.html
styles.css

src/
  main.js                    Browser UI, events, rendering orchestration
  actions.js                 Project and work item state actions
  artifacts.js               PRD, packages, quality report, artifact migration
  automation.js              Development/review automation runs and result application
  codexWorkflow.js           Codex package, prompt, result contract
  collaboration.js           Work item generation and agent result normalization
  findings.js                Structured review finding normalization and formatting
  schemas.js                 Lightweight schema validation
  storage.js                 localStorage and import/export helpers
  utils.js                   Shared utility functions

src/engines/
  plannerEngine.js           Local planning engine
  llmClient.js               LLM endpoint allowlist and JSON request handling
  llmEngine.js               LLM orchestration for planning and feedback

src/render/
  projectList.js             Project list renderer
  tabs.js                    Tab renderer

agents/
  development-agent/         File-based developer agent MVP
  code-review-agent/         File-based code review agent MVP
  codex-development-agent/   Codex schemas and prompt helpers
  runner/                    Local HTTP server and codex exec bridge

test/
  *.test.mjs                 Node built-in test runner coverage

docs/plan/
  refactoring-plan.md        Refactoring and implementation history
```

## Workflow Detail

### 1. 기획 생성

```text
Idea
  -> Diagnosis
  -> Questions
  -> Assumptions
  -> MVP
  -> Scenario
  -> Experiment
  -> PRD
```

### 2. 개발 작업 분해

```text
Development Package
  -> work_dev_1
  -> work_dev_2
  -> ...
```

### 3. 코드 리뷰 작업 생성

```text
work_dev_1
  -> work_review_dev_1

work_dev_2
  -> work_review_dev_2
```

### 4. Codex Handoff

```text
Work Item
  -> Codex Package
  -> Codex Prompt
  -> Runner or Markdown fallback
```

### 5. 결과 반영

```text
Agent Result JSON
  -> Import Result
  -> Work Item Status Update
  -> Logs Update
  -> Review/Revision Flow
```

## How To Run

### Full Workflow with Local Runner

```powershell
node agents\runner\server.mjs
```

Open:

```text
http://127.0.0.1:4173/index.html
```

### Static UI Only

```powershell
python -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/index.html
```

Static mode에서는 Codex 실행 대신 prompt 다운로드 중심으로 사용할 수 있습니다.

## Manual Feature Test

### 1. Product Planning

1. 브라우저에서 앱 접속
2. 아이디어 입력
3. `기획 산출물 생성` 클릭
4. PRD, 개발, 검증, 에이전트 탭 확인

### 2. Developer Result Import

```json
{
  "agentRole": "developer",
  "workItemId": "work_dev_1",
  "status": "pass",
  "findings": ["Implemented basic change"],
  "recommendedChanges": [],
  "changedFiles": ["src/example.js"],
  "tests": ["node --test"],
  "risks": [],
  "approvalGate": "approved"
}
```

기대 결과:

- `work_dev_1` 상태가 `Pass`
- `work_review_dev_1` 상태가 `Ready`

### 3. Reviewer Result Import

```json
{
  "agentRole": "reviewer",
  "workItemId": "work_review_dev_1",
  "status": "needs_revision",
  "findings": [
    {
      "severity": "high",
      "file": "src/example.js",
      "line": 12,
      "title": "Missing regression test",
      "description": "The implementation has no focused test for the changed behavior.",
      "recommendation": "Add a test that fails before the fix and passes after it."
    }
  ],
  "recommendedChanges": ["Add focused regression coverage."],
  "changedFiles": [],
  "tests": ["node --test"],
  "risks": [],
  "approvalGate": "requires_user_decision"
}
```

기대 결과:

- `work_review_dev_1` 상태가 `Needs Revision`
- 연결된 `work_dev_1`도 `Needs Revision`
- Imported Agent Results에 severity, file:line, recommendation 표시

## Local Agent Scripts

### Development Agent

```powershell
node agents\development-agent\scripts\validate-input.mjs package.json work-item.json
node agents\development-agent\scripts\create-result-template.mjs work-item.json result.json
```

### Code Review Agent

```powershell
node agents\code-review-agent\scripts\validate-input.mjs package.json review-work-item.json
node agents\code-review-agent\scripts\create-result-template.mjs review-work-item.json review-result.json
```

## Test

```powershell
node --test
```

Current result:

```text
70 passing
```

Useful syntax checks:

```powershell
node --check src\main.js
node --check src\automation.js
node --check src\codexWorkflow.js
node --check agents\runner\server.mjs
node --check agents\code-review-agent\scripts\create-result-template.mjs
```

## Engineering Highlights

- Prototype-level `app.js` 구조를 ES Modules 기반 구조로 리팩토링
- 기획, LLM, storage, collaboration, automation, Codex workflow를 모듈화
- developer / validator / reviewer 역할 분리
- 개발 결과와 코드 리뷰 결과를 work item 상태와 자동 연동
- Codex 실행과 file-based handoff를 모두 지원
- API key를 localStorage에 저장하지 않도록 persistence sanitization 적용
- structured review finding을 도입해 코드 리뷰 결과를 추적 가능한 데이터로 전환
- Node built-in test runner 기반 회귀 테스트 구성

## Current Status

완료된 핵심 범위:

- Product Planning Builder UI
- PRD / Development / Validation / Agent Package 생성
- Collaboration Board
- Developer work item workflow
- Code review work item workflow
- Structured review findings
- Codex development/review package generation
- Local Codex Runner
- File-based development agent scaffold
- File-based code review agent scaffold
- 70개 자동 테스트

다음 개선 후보:

- Collaboration Board renderer 추가 분리
- severity filter UI
- browser smoke test 자동화
- review finding을 severity별로 그룹화
- 실제 Git diff 기반 changed file 검증
