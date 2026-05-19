# AI Product Planning Builder

제품 아이디어를 기획 산출물로 구조화하고, 개발 work item을 Codex 실행까지 연결하는 브라우저 기반 Product Builder입니다.  
단순 PRD 생성 도구가 아니라 **기획 → 개발 작업 분해 → Codex 구현 실행 → 결과 반영**까지 이어지는 에이전트 협업 워크플로우를 목표로 합니다.

## Overview

이 프로젝트는 초기 제품 아이디어를 입력받아 다음 산출물을 생성합니다.

- Product Package
- PRD
- Development Package
- Validation Package
- Agent Package
- Agent Collaboration Board

이후 Agent Collaboration Board에서 개발/검증 작업을 work item으로 분리하고, 개발 work item은 Development Agent 또는 Codex Runner로 넘길 수 있습니다.

```text
Idea
  -> Product Planning Artifacts
  -> Development / Validation Work Items
  -> Codex Development Package
  -> Local Codex Runner
  -> Agent Result JSON
  -> Collaboration Board Update
```

## Tech Stack

| Area | Stack |
| --- | --- |
| Frontend | HTML, CSS, Vanilla JavaScript ES Modules |
| Runtime | Browser, Node.js |
| Storage | Browser localStorage |
| Testing | Node built-in test runner |
| LLM Integration | OpenAI Chat Completions API compatible endpoint |
| Agent Execution | Codex CLI via local Node Runner |
| Automation | File-based JSON handoff, local HTTP API |

별도 프론트엔드 프레임워크나 빌드 도구 없이 정적 앱으로 동작하도록 구성했습니다. 핵심 도메인 로직은 `src/*` 모듈로 분리하고 Node 테스트로 검증합니다.

## Key Features

- 제품 아이디어 기반 기획 산출물 생성
- PRD Markdown 생성
- Development Package 생성
  - 기술 설계
  - 데이터 모델
  - API 명세
  - 개발 작업 목록
- Validation Package 생성
  - 리스크
  - MVP 적정성
  - 출시 전 체크리스트
- Agent Collaboration Board
  - 개발/검증 work item 관리
  - 상태 전이 관리
  - Agent Result JSON 가져오기
- Codex Development Workflow
  - Codex Package 생성
  - Codex Prompt 생성
  - Local Runner를 통한 `codex exec` 실행
  - 실행 결과 자동 반영
- 프로젝트 저장/import/export
- 결정 로그, 변경 로그, 버전 비교
- API Key localStorage 저장 방지

## Architecture

```text
index.html
styles.css
src/
  main.js              Browser app, rendering, events
  storage.js           localStorage and file download helpers
  schemas.js           Package schema validation
  collaboration.js     Work items and Agent Result normalization
  automation.js        Automation runs and result application
  codexWorkflow.js     Codex package, prompt, result contract

agents/
  development-agent/   File-based development agent MVP
  codex-development-agent/
                       Codex package/prompt/result schemas and CLI helpers
  runner/              Local HTTP server and codex exec bridge

test/                  Node unit tests
docs/plan/             Implementation and refactoring plans
```

## Workflow

### 1. Planning

사용자가 제품 아이디어를 입력하면 Product Builder가 기획 산출물을 생성합니다.

```text
Idea
  -> Questions
  -> Assumptions
  -> MVP Scope
  -> Scenario
  -> Experiment Plan
  -> PRD
  -> Development Package
  -> Validation Package
```

LLM API를 사용할 수 있으며, 실패 시 로컬 생성 엔진으로 fallback합니다.

### 2. Work Item Generation

Development Package와 Validation Package를 기반으로 Agent Collaboration Board가 생성됩니다.

work item 상태 흐름:

```text
ready
  -> exported
  -> in_review
  -> pass | needs_revision | blocked
```

실행 가능한 developer work item 상태:

```text
ready
exported
needs_revision
```

`in_review` 상태는 중복 실행 방지를 위해 자동 실행 대상에서 제외됩니다.

### 3. Codex Handoff

developer work item은 Codex 작업으로 넘길 수 있습니다.

UI에서 가능한 액션:

- `Codex Package`: Codex용 JSON 작업 패키지 생성
- `Codex Prompt`: Codex용 Markdown 프롬프트 생성
- `Codex 시작`: 다음 실행 가능한 developer work item을 Codex로 전달
- `생성 후 Codex Prompt 만들기`: 기획 산출물 생성 직후 Codex handoff 실행

Runner가 실행 중이면 실제 `codex exec`를 호출하고, Runner가 없으면 Prompt Markdown 다운로드로 fallback합니다.

### 4. Codex Execution

Local Runner는 Codex CLI를 비대화식으로 실행합니다.

```text
Product Builder UI
  -> POST /api/codex-runs
  -> agents/runner/server.mjs
  -> codex exec
  -> .agent-runs/<runId>/result.json
  -> Product Builder auto import
```

Codex 실행 결과는 Agent Result JSON으로 정규화됩니다.

```json
{
  "agentRole": "developer",
  "workItemId": "work_dev_1",
  "status": "pass",
  "findings": [],
  "recommendedChanges": [],
  "changedFiles": [],
  "tests": [],
  "risks": [],
  "approvalGate": "approved",
  "codexEvidence": {
    "commands": [],
    "notes": []
  }
}
```

### 5. Result Import

결과 JSON이 반영되면 다음 데이터가 갱신됩니다.

- work item status
- agentRuns
- automationRuns
- decisionLogs
- changeLogs
- codexEvidence

## How to Run

### Option A. Full Workflow with Codex Runner

Codex 실행까지 연결하려면 Runner를 실행합니다.

```powershell
node agents\runner\server.mjs
```

브라우저에서 접속합니다.

```text
http://127.0.0.1:4173/index.html
```

Runner는 정적 앱과 API를 함께 제공합니다.

### Option B. Static UI Only

Codex 실행 없이 UI와 파일 기반 handoff만 확인하려면 정적 서버로 실행할 수 있습니다.

```powershell
python -m http.server 4173
```

```text
http://127.0.0.1:4173/index.html
```

이 경우 `Codex 시작`은 실제 실행 대신 Prompt 다운로드로 fallback합니다.

## Runner API

Local Runner API:

```text
GET  /api/runner/health
POST /api/codex-runs
GET  /api/codex-runs/:id
GET  /api/codex-runs/:id/logs
GET  /api/codex-runs/:id/result
```

Codex 실행 산출물:

```text
.agent-runs/
  codex_run_xxx/
    package.json
    prompt.md
    stdout.jsonl
    stderr.log
    status.json
    result.json
```

Runner는 다음 원칙으로 동작합니다.

- `127.0.0.1`에서만 listen
- `workspace-write` sandbox 사용
- `danger-full-access` 미사용
- 결과 JSON 검증 실패 시 `blocked` 결과로 변환

## LLM API

사이드바의 `LLM API` 패널에서 OpenAI Chat Completions API 호환 endpoint를 설정할 수 있습니다.

기본값:

```text
Endpoint: https://api.openai.com/v1/chat/completions
Model: gpt-4o-mini
```

보안 정책:

- API Key는 `localStorage`에 저장하지 않습니다.
- API Key는 현재 페이지 세션 메모리에만 유지됩니다.
- 새로고침 후에는 API Key를 다시 입력해야 합니다.
- 허용된 HTTPS endpoint만 사용할 수 있습니다.

## Validation

전체 테스트:

```powershell
node --test
```

문법 검사:

```powershell
node --check src\main.js
node --check src\automation.js
node --check src\codexWorkflow.js
node --check agents\runner\server.mjs
```

Development Agent smoke test:

```powershell
node agents\development-agent\scripts\validate-input.mjs `
  agents\development-agent\examples\collaboration-package.example.json `
  agents\development-agent\examples\work-item.example.json

node agents\development-agent\scripts\create-result-template.mjs `
  agents\development-agent\examples\work-item.example.json
```

Codex Agent smoke test:

```powershell
node agents\codex-development-agent\scripts\create-codex-prompt.mjs `
  agents\codex-development-agent\examples\codex-development-package.example.json

node agents\codex-development-agent\scripts\validate-codex-result.mjs `
  agents\codex-development-agent\examples\codex-result.example.json
```

최근 검증 결과:

```text
41 pass / 0 fail
```

## Portfolio Highlights

- 빌드 도구 없이 ES Module 기반 정적 앱 구성
- 기획 산출물, 개발 작업, 에이전트 결과를 JSON 계약으로 연결
- 브라우저 보안 제약을 우회하지 않고 Local Runner로 Codex 실행 분리
- `codex exec` 결과를 Product Builder의 협업 보드로 자동 반영
- API Key를 저장하지 않는 LLM 연동 구조
- 도메인 로직을 테스트 가능한 순수 모듈로 분리
- 실패한 Codex 실행을 `blocked` Agent Result로 정규화

## Roadmap

- Codex run queue와 재시도 UI
- 실행 로그 실시간 스트리밍
- Git branch / commit / PR 생성 연동
- GitHub Issue 또는 Linear ticket export
- SQLite/PostgreSQL 기반 영속 저장소
- 브라우저 E2E 테스트
- PDF/DOCX export
