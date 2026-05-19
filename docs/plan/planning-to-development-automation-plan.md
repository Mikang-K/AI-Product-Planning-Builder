# 기획-개발 자동 연동 구현 계획

## 1. 목표

현재 Product Builder는 제품 아이디어를 받아 PRD, Development Package, Validation Package, Agent Collaboration Board를 생성하고, 개발 에이전트는 파일 기반으로 Collaboration Package와 Development Work Item을 검증한 뒤 Agent Result JSON을 생성한다.

이번 구현의 목표는 이 두 흐름을 자동으로 연결하는 것이다.

## 구현 상태

2026-05-19 기준으로 MVP 자동 연동 구현을 완료했다.

구현된 항목:

- `src/automation.js`
- `test/automation.test.mjs`
- Agent Collaboration Board의 `Run Package` 액션
- Agent Collaboration Board의 `Run All Ready Dev` 액션
- Development Agent CLI 안내 영역
- Development Automation Runs 표시
- Agent Result Import와 automation run 상태 연결

검증 완료 항목:

- 자동화 도메인 테스트 통과
- `src/automation.js` 문법 검사 통과
- `src/main.js` 문법 검사 통과
- 전체 `node --test` 통과

현재 흐름:

```text
Product Builder
  -> Collaboration Package 수동 내보내기
  -> Work Item 수동 내보내기
  -> 개발 에이전트 CLI 수동 실행
  -> Agent Result JSON 수동 가져오기
```

목표 흐름:

```text
Product Builder
  -> 기획/개발 산출물 생성
  -> 실행 가능한 개발 work item 자동 탐색
  -> 개발 에이전트 입력 패키지 자동 생성
  -> 개발 에이전트 실행 또는 실행 안내
  -> Agent Result JSON 자동 검증
  -> Collaboration Board 상태 자동 반영
```

## 2. 설계 원칙

- 정적 브라우저 앱의 제약을 먼저 인정한다.
- 브라우저에서 로컬 CLI를 직접 실행하지 않는다.
- 첫 단계는 자동 실행이 아니라 자동 패키징과 자동 결과 반영까지 구현한다.
- 로컬 Runner 서버는 두 번째 단계로 분리한다.
- 모든 자동화 결과는 기존 Agent Result JSON 계약과 호환되어야 한다.
- 사용자의 승인 없이 MVP 범위를 벗어난 작업을 자동으로 확장하지 않는다.

## 3. 전체 아키텍처

```text
src/automation.js
  -> 실행 가능한 work item 탐색
  -> 개발 에이전트 입력 생성
  -> 자동화 run 상태 생성
  -> Agent Result 적용

Product Builder UI
  -> Run Developer Agent Package
  -> Run All Ready Developer Tasks
  -> Import Agent Result

agents/development-agent
  -> validate-input.mjs
  -> create-result-template.mjs

향후 agents/runner
  -> 브라우저 요청 수신
  -> 개발 에이전트 CLI 실행
  -> 결과 JSON 반환
```

## 4. MVP 범위

첫 구현에서 포함할 항목:

- 실행 가능한 developer work item 탐색
- 선택된 work item 기준 Collaboration Package 생성
- Development Work Item JSON 생성
- 자동화 run 상태 모델 추가
- Agent Result JSON 검증 및 적용
- work item 상태 자동 변경
- agentRuns 기록 추가
- Node 테스트 추가
- UI에서 자동화 패키지 생성 버튼 추가

첫 구현에서 제외할 항목:

- 브라우저에서 CLI 직접 실행
- GitHub Issue 자동 생성
- Pull Request 생성
- 실제 대상 코드베이스 자동 수정
- 장기 실행 백그라운드 에이전트
- 서버 API 기반 완전 자동 실행

## 5. 데이터 모델

### 5.1 Automation Run

```json
{
  "id": "automation_run_1",
  "projectId": "project_1",
  "agentRole": "developer",
  "status": "queued",
  "workItemIds": ["work_dev_1"],
  "createdAt": "2026-05-19T00:00:00.000Z",
  "startedAt": null,
  "completedAt": null,
  "resultIds": [],
  "error": ""
}
```

허용 상태:

```text
queued
running
completed
failed
cancelled
```

### 5.2 Development Agent Input

```json
{
  "collaborationPackage": {},
  "workItem": {},
  "run": {
    "id": "automation_run_1",
    "projectId": "project_1",
    "workItemIds": ["work_dev_1"]
  }
}
```

### 5.3 Agent Result

기존 Product Builder의 Agent Result Import 형식을 그대로 사용한다.

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
  "approvalGate": "approved"
}
```

## 6. 모듈 설계

### 6.1 `src/automation.js`

추가할 함수:

```js
export function getRunnableDevelopmentWorkItems(project) {}
export function createAutomationRun(project, workItemIds, options = {}) {}
export function buildDevelopmentAgentInput(project, workItem) {}
export function applyAgentResultToAutomation(project, result, runId) {}
export function automationRunStatuses() {}
```

책임:

- `developer` 역할의 work item만 선택한다.
- `ready`, `exported`, `needs_revision` 상태를 실행 가능한 항목으로 본다.
- 이미 `in_review`인 항목은 중복 실행하지 않는다.
- Collaboration Package와 Work Item을 한 번에 묶어 에이전트 입력으로 만든다.
- Agent Result 적용 시 기존 `normalizeAgentResult`를 재사용한다.
- 결과 적용 후 work item 상태와 automation run 상태를 갱신한다.

### 6.2 `src/collaboration.js` 확장

필요 시 다음 헬퍼를 추가한다.

```js
export function findWorkItem(collaboration, workItemId) {}
export function updateWorkItemStatus(collaboration, workItemId, status) {}
```

기존 함수와 중복되면 새 추상화를 만들지 않고 기존 로직을 재사용한다.

### 6.3 `src/main.js` UI 연동

Agent Collaboration Board에 다음 액션을 추가한다.

- `Run Developer Package`
- `Run All Ready Dev`
- `Copy CLI Command`
- `Import Result`

정적 앱 MVP에서는 실제 실행 대신 다음을 제공한다.

- 자동화 run 생성
- Collaboration Package JSON 다운로드
- Work Item JSON 다운로드
- 개발 에이전트 CLI 명령 표시
- 결과 JSON 가져오기 후 자동 반영

## 7. UI 워크플로우

### 7.1 단일 작업 실행 패키지 생성

1. 사용자가 Agent Collaboration Board에서 developer work item을 선택한다.
2. `Run Developer Package` 버튼을 누른다.
3. 앱이 automation run을 생성한다.
4. 앱이 Collaboration Package와 Work Item JSON을 내보낸다.
5. 앱이 실행 명령을 표시한다.

예시 명령:

```powershell
node agents\development-agent\scripts\validate-input.mjs package.json work-item.json
node agents\development-agent\scripts\create-result-template.mjs work-item.json result.json
```

### 7.2 전체 ready 개발 작업 패키지 생성

1. `Run All Ready Dev` 버튼을 누른다.
2. 앱이 실행 가능한 developer work item 목록을 찾는다.
3. 각 work item에 대한 입력 패키지를 생성한다.
4. 각 작업은 `exported` 또는 `in_review` 상태로 전환된다.

### 7.3 결과 반영

1. 사용자가 개발 에이전트 결과 JSON을 가져온다.
2. 앱이 Agent Result JSON을 검증한다.
3. `workItemId`와 `agentRole`이 일치하는지 확인한다.
4. work item 상태를 결과의 `status`로 변경한다.
5. `agentRuns`에 결과를 추가한다.
6. automation run을 `completed` 또는 `failed`로 갱신한다.

## 8. 로컬 Runner 서버 확장 계획

MVP 이후에는 브라우저와 개발 에이전트 사이에 로컬 Runner 서버를 둔다.

예상 구조:

```text
agents/
  runner/
    README.md
    server.mjs
    routes/
      run-development-agent.mjs
```

API:

```http
POST /api/agent-runs/development
```

요청:

```json
{
  "projectId": "project_1",
  "collaborationPackage": {},
  "workItem": {}
}
```

응답:

```json
{
  "runId": "automation_run_1",
  "status": "completed",
  "result": {
    "agentRole": "developer",
    "workItemId": "work_dev_1",
    "status": "pass",
    "findings": [],
    "recommendedChanges": [],
    "changedFiles": [],
    "tests": [],
    "risks": [],
    "approvalGate": "approved"
  }
}
```

Runner 책임:

- 요청 본문 검증
- 임시 작업 디렉터리 생성
- `validate-input.mjs` 실행
- 개발 에이전트 실행 또는 결과 템플릿 생성
- 결과 JSON 반환
- 실행 로그 저장

## 9. 구현 단계

### 9.1 자동화 도메인 모듈 추가

파일:

```text
src/automation.js
test/automation.test.mjs
```

구현:

- 실행 가능한 개발 작업 탐색
- 자동화 run 생성
- 개발 에이전트 입력 생성
- Agent Result 적용

검증:

- developer work item만 선택되는지 확인
- 실행 불가능한 상태는 제외되는지 확인
- result 적용 시 상태가 변경되는지 확인
- 잘못된 result는 거부되는지 확인

### 9.2 UI 액션 추가

파일:

```text
src/main.js
styles.css
```

구현:

- Agent Collaboration Board에 자동화 버튼 추가
- 단일 developer work item 실행 패키지 생성
- 전체 ready developer work item 패키지 생성
- CLI 명령 표시 영역 추가

검증:

- 버튼 클릭 시 JSON 다운로드가 발생하는지 확인
- work item 상태가 기대대로 변경되는지 확인
- 긴 명령어가 UI에서 깨지지 않는지 확인

### 9.3 결과 가져오기 개선

파일:

```text
src/main.js
src/collaboration.js
src/automation.js
```

구현:

- Agent Result 가져오기 시 automation run과 연결
- 결과 적용 후 work item 상태 변경
- 권고사항, 테스트, 리스크 표시 강화

검증:

- 정상 result import
- 알 수 없는 workItemId 거부
- agentRole 불일치 거부
- blocked 결과 반영

### 9.4 개발 에이전트 CLI와 연결 안내 강화

파일:

```text
agents/development-agent/README.md
docs/plan/development-agent-implementation-plan.md
```

구현:

- Product Builder에서 생성한 파일을 CLI에 전달하는 방식 설명
- 결과 JSON을 다시 가져오는 방식 설명
- 자동화 run과 CLI 결과의 관계 설명

### 9.5 로컬 Runner 서버 추가

파일:

```text
agents/runner/README.md
agents/runner/server.mjs
agents/runner/routes/run-development-agent.mjs
test/runner.test.mjs
```

구현:

- HTTP 서버
- 개발 에이전트 실행 엔드포인트
- 요청/응답 JSON 검증
- 실행 로그 저장

이 단계는 MVP 안정화 이후 진행한다.

## 10. 테스트 계획

자동 테스트:

```powershell
node --test
```

추가 테스트 파일:

```text
test/automation.test.mjs
test/runner.test.mjs
```

테스트 케이스:

- ready 상태 developer work item 탐색
- validator work item 제외
- in_review 상태 중복 실행 방지
- Collaboration Package와 Work Item 입력 생성
- Agent Result 적용
- unknown workItemId 거부
- agentRole 불일치 거부
- automation run completed 처리
- automation run failed 처리

수동 테스트:

1. 브라우저에서 프로젝트 생성
2. Agent Collaboration Board 열기
3. 개발 작업 패키지 생성
4. 표시된 CLI 명령 실행
5. 생성된 result JSON 가져오기
6. work item 상태와 agentRuns 표시 확인

## 11. 완료 기준

MVP 완료 기준:

- `src/automation.js`가 자동화 흐름의 핵심 상태를 관리한다.
- Product Builder에서 개발 에이전트 입력 패키지를 자동으로 만들 수 있다.
- 개발 에이전트 결과를 가져오면 work item과 agentRuns가 자동 갱신된다.
- 관련 테스트가 `node --test`에서 통과한다.
- 사용자는 수동 파일 편집 없이 기획 산출물에서 개발 에이전트 입력까지 이어갈 수 있다.

확장 완료 기준:

- 로컬 Runner 서버가 개발 에이전트 CLI를 실행한다.
- Product Builder 버튼 클릭만으로 개발 에이전트 실행과 결과 반영이 가능하다.
- 실패 로그와 재시도 흐름을 UI에서 확인할 수 있다.

## 12. 권장 구현 순서

1. `src/automation.js`와 테스트 추가
2. Agent Result 적용 흐름을 자동화 run과 연결
3. Agent Collaboration Board에 실행 패키지 생성 버튼 추가
4. CLI 실행 안내와 결과 가져오기 UX 개선
5. 전체 테스트와 수동 브라우저 테스트 수행
6. 로컬 Runner 서버 설계 검증
7. Runner 서버 구현
8. 버튼 클릭 기반 완전 자동 실행으로 확장
