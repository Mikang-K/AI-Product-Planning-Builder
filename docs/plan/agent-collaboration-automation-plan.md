# 에이전트 협업 자동화 구현 계획

## 1. 목표

현재 Product Builder가 생성하는 산출물을 개발 자동화 에이전트와 검증 자동화 에이전트가 바로 이어받을 수 있는 작업 패키지로 변환하고, 외부 에이전트의 실행 결과를 다시 프로젝트 이력으로 가져올 수 있게 한다.

이 기능의 목표는 단순한 문서 내보내기가 아니다. 다음과 같은 실제 협업 루프를 지원하는 것이 핵심이다.

```text
Product Package
  -> 개발/검증 작업 항목 생성
  -> 외부 에이전트 실행
  -> 에이전트 결과 가져오기
  -> 리뷰, 로그 기록, 필요 시 PRD 업데이트
```

## 2. 현재 기준 상태

현재 프로젝트는 이미 다음 산출물을 생성한다.

- Product Package
- Development Package
- Validation Package
- Agent Package
- Quality Report
- PRD Markdown 내보내기
- 프로젝트 JSON 내보내기/가져오기
- 사용자 피드백 기반 업데이트
- 결정 로그, 변경 로그, 버전 이력

이 계획은 위 산출물을 외부 개발/검증 에이전트가 사용할 수 있는 구조화된 협업 데이터로 확장한다.

## 3. 목표 기능

### 3.1 Collaboration Package

정규화된 협업 패키지를 만든다.

포함할 항목:

- `projectContext`: 제품 요약, 타깃 사용자, 문제, 가치 제안, MVP 범위
- `handoffInputs`: PRD, 개발 패키지, 검증 패키지, 결정 로그
- `workItems`: 개발/검증 에이전트가 수행할 작업 항목
- `acceptanceCriteria`: 각 작업의 완료 기준
- `blockedBy`: 선행 의존성
- `expectedOutputs`: 외부 에이전트가 반환해야 하는 결과 형식
- `reviewChecklist`: 사용자가 승인하거나 확인해야 할 체크포인트

### 3.2 개발 에이전트 작업 보드

`artifacts.development.tasks`, `apiSpec`, `dataModels`, MVP 기능을 바탕으로 개발 작업 항목을 생성한다.

개발 작업 항목 예시:

```json
{
  "id": "work_dev_001",
  "agentRole": "developer",
  "title": "프로젝트 저장 API 구현",
  "status": "ready",
  "priority": "must_have",
  "inputArtifacts": ["prd", "development.apiSpec", "development.dataModels"],
  "acceptanceCriteria": [
    "API 동작이 생성된 명세와 일치한다.",
    "실패 케이스가 명확한 에러 메시지를 반환한다.",
    "검증 단계 또는 테스트 결과가 함께 보고된다."
  ],
  "expectedOutput": {
    "changedFiles": [],
    "summary": "string",
    "tests": [],
    "risks": []
  }
}
```

UI 액션:

- 프롬프트 복사
- 단일 작업 JSON 내보내기
- 상태 변경
- 전체 개발 에이전트 패키지 JSON 내보내기

### 3.3 검증 에이전트 작업 보드

다음 데이터를 바탕으로 검증 작업 항목을 생성한다.

- `artifacts.validation.risks`
- `artifacts.validation.experimentReview`
- `artifacts.validation.launchChecklist`
- PRD 품질 점검
- MVP 적정성 점검

검증 에이전트는 발견 사항, 심각도, 권고 변경사항을 반환해야 한다.

결과 JSON 예시:

```json
{
  "agentRole": "validator",
  "workItemId": "work_val_001",
  "status": "pass",
  "findings": [],
  "recommendedChanges": [],
  "approvalGate": "approved"
}
```

허용되는 `status` 값:

```text
pass
needs_revision
blocked
```

허용되는 `approvalGate` 값:

```text
approved
requires_user_decision
```

### 3.4 에이전트 결과 가져오기

외부 에이전트가 만든 결과 JSON을 Product Builder로 가져오는 흐름을 추가한다.

가져오기 시 처리할 일:

- `agentRole` 검증
- `workItemId` 검증
- `status` 검증
- 결과를 `project.collaboration.agentRuns`에 저장
- 일치하는 작업 항목의 상태 업데이트
- 결정 로그 추가
- 권고 변경사항이 있으면 변경 로그 추가

첫 MVP에서는 에이전트 권고사항이 프로젝트 산출물을 자동으로 덮어쓰지 않게 한다. 권고사항은 리뷰 대상으로 저장한다.

### 3.5 승인 게이트

에이전트 권고사항을 핵심 산출물에 반영하기 전 사용자 승인 단계를 둔다.

승인이 필요한 항목:

- MVP 범위 변경
- PRD 주요 섹션 수정
- API 명세 변경
- 개발 작업 추가/삭제
- `requires_user_decision`으로 표시된 검증 결과

승인 액션:

- 반영
- 보류
- 수정 후 반영

승인된 권고사항은 가능한 한 기존 `applyProjectFeedback()` 흐름을 재사용해 반영한다.

## 4. 데이터 모델

각 프로젝트에 다음 구조를 추가한다.

```js
project.collaboration = {
  workItems: [],
  agentRuns: [],
  approvals: [],
  updatedAt: ""
};
```

### 4.1 Work Item

```js
{
  id: "work_dev_001",
  agentRole: "developer",
  source: "development.tasks",
  title: "string",
  description: "string",
  status: "draft|ready|exported|in_review|pass|needs_revision|blocked",
  priority: "must_have|should_have|could_have|high|medium|low",
  inputArtifacts: [],
  acceptanceCriteria: [],
  blockedBy: [],
  expectedOutput: {},
  createdAt: "",
  updatedAt: ""
}
```

### 4.2 Agent Run

```js
{
  id: "agent_run_001",
  workItemId: "work_dev_001",
  agentRole: "developer|validator",
  status: "pass|needs_revision|blocked",
  findings: [],
  recommendedChanges: [],
  changedFiles: [],
  tests: [],
  risks: [],
  approvalGate: "approved|requires_user_decision",
  importedAt: ""
}
```

### 4.3 Approval

```js
{
  id: "approval_001",
  agentRunId: "agent_run_001",
  decision: "applied|held|revised",
  reason: "string",
  createdAt: ""
}
```

## 5. 구현 단계

### 5.1 Collaboration 마이그레이션 추가

모든 프로젝트에 다음 필드가 존재하도록 보장한다.

- `collaboration.workItems`
- `collaboration.agentRuns`
- `collaboration.approvals`
- `collaboration.updatedAt`

프로젝트 로드 시점과 JSON 가져오기 시점에 실행한다.

### 5.2 작업 항목 생성

추가할 함수:

- `buildCollaborationPackage(project)`
- `buildDevelopmentWorkItems(project)`
- `buildValidationWorkItems(project)`
- `mergeGeneratedWorkItems(existingItems, generatedItems)`

작업 항목 ID는 매번 렌더링할 때 중복 생성되지 않도록 안정적으로 만든다.

### 5.3 협업 보드 렌더링

현재 `에이전트` 탭을 확장하거나 별도 `협업` 탭을 추가한다.

보드에 표시할 항목:

- 개발 작업 항목
- 검증 작업 항목
- 상태 배지
- 완료 기준
- 예상 출력 형식
- 내보내기/복사 액션
- 가져온 에이전트 결과

### 5.4 협업 패키지 내보내기

다음 내보내기를 추가한다.

- 전체 Collaboration Package JSON
- Development Agent Package JSON
- Validation Agent Package JSON
- 단일 Work Item JSON
- 단일 Work Item Prompt Markdown

### 5.5 에이전트 결과 가져오기

숨김 파일 입력과 가져오기 버튼을 추가한다.

검증 규칙:

- `agentRole`은 `developer` 또는 `validator`
- `workItemId`는 기존 작업 항목과 일치
- `status`는 `pass`, `needs_revision`, `blocked`
- `recommendedChanges`는 존재할 경우 배열

### 5.6 결과 저장 및 로그 갱신

가져오기에 성공하면 다음을 수행한다.

- `project.collaboration.agentRuns`에 결과 추가
- 일치하는 작업 항목 상태 업데이트
- 결정 로그 추가
- 권고 변경사항이 있으면 변경 로그 추가
- 상태 저장 후 화면 다시 렌더링

### 5.7 승인 리뷰 추가

사용자 확인이 필요한 권고사항을 표시한다.

MVP 동작:

- 권고사항 표시
- 사용자가 보류 또는 반영으로 표시
- 결정을 `project.collaboration.approvals`에 기록

추후 동작:

- 승인된 권고사항을 구조화된 피드백으로 변환
- `applyProjectFeedback()` 재사용

## 6. MVP 범위

첫 구현에 포함할 항목:

- `project.collaboration` 데이터 구조
- 개발/검증 작업 항목 생성
- 협업 보드 UI
- 전체 Collaboration Package JSON 내보내기
- Agent Result JSON 가져오기
- 결과 저장 및 로그 업데이트

다음 반복으로 미룰 항목:

- 에이전트 권고사항을 PRD/산출물에 자동 반영
- 수정 후 반영까지 포함한 전체 승인 UI
- GitHub/Linear/Jira 연동
- 서버 기반 협업 API
- 데이터베이스 기반 협업 이력

## 7. 위험 요소

- 작업 항목 ID가 목록 순서에만 의존하면 산출물 변경 시 결과 매칭이 흔들릴 수 있다.
- PRD가 변경된 뒤 이전 에이전트 결과를 가져오면 stale result가 될 수 있다.
- 권고사항 자동 반영은 사용자 의도를 덮어쓸 수 있다.
- 협업 패키지가 커지면 브라우저 `localStorage` 용량 한계에 가까워질 수 있다.
- 외부 에이전트 출력이 느슨하면 결과 import 실패가 늘어날 수 있다.

## 8. 권장 구현 순서

1. Collaboration 마이그레이션과 데이터 구조 추가
2. 개발/검증 작업 항목 생성
3. 협업 보드 렌더링
4. 전체 패키지 내보내기
5. 에이전트 결과 가져오기
6. 로그와 상태 업데이트
7. README 업데이트와 스모크 테스트

## 9. 검증 체크리스트

명령어:

```powershell
node --check src/main.js
node --test
```

수동 확인:

- 프로젝트 생성
- 에이전트/협업 보드 열기
- 개발/검증 작업 항목 생성 확인
- 전체 협업 패키지 내보내기
- 유효한 에이전트 결과 JSON 가져오기
- 작업 항목 상태 변경 확인
- 결정 로그/변경 로그 갱신 확인
- 잘못된 JSON 가져오기 시 거부 확인
