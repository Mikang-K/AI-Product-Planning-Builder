# 개발 에이전트 구현 계획

## 1. 목표

Product Builder가 생성한 Collaboration Package를 입력으로 받아, 선택된 개발 작업 항목을 구현 가능한 계획과 결과 JSON으로 변환하는 개발 자동화 에이전트를 만든다.

개발 에이전트는 사용자의 판단을 대체하지 않는다. 역할은 다음과 같다.

- 현재 Product/Development/Validation 산출물을 읽는다.
- 특정 개발 작업 항목을 선택하거나 입력받는다.
- 구체적인 구현 계획을 만든다.
- 대상 코드베이스가 연결되어 있으면 실제 파일 수정까지 수행할 수 있다.
- Product Builder가 다시 가져올 수 있는 구조화된 Agent Result JSON을 반환한다.

## 구현 상태

2026-05-19 기준으로 파일 기반 MVP 구현을 완료했다.

구현된 항목:

- `agents/development-agent/README.md`
- `agents/development-agent/agent.md`
- `agents/development-agent/schemas/*.schema.json`
- `agents/development-agent/examples/*.example.json`
- `agents/development-agent/scripts/validate-input.mjs`
- `agents/development-agent/scripts/create-result-template.mjs`
- `agents/development-agent/scripts/development-agent-lib.mjs`
- `test/development-agent.test.mjs`

검증 완료 항목:

- 예시 Collaboration Package와 Development Work Item 검증
- 누락된 work item 거부
- Agent Result 템플릿 생성
- 전체 `node --test` 통과

## 2. Product Builder와의 연결 방식

Product Builder는 이미 다음 산출물을 만든다.

- PRD
- Development Package
- API 명세
- 데이터 모델
- 개발 작업 목록
- Agent Collaboration Board
- Collaboration Package JSON
- Work Item JSON
- Agent Result JSON 가져오기

개발 에이전트는 다음 파일 기반 흐름으로 연결된다.

```text
Product Builder
  -> Full Collaboration Package JSON
  -> Development Work Item JSON
  -> Development Agent
  -> Agent Result JSON
  -> Product Builder Result Import
```

## 3. MVP 범위

첫 구현은 파일 기반 워크플로우를 지원한다.

포함 항목:

- Full Collaboration Package JSON 읽기
- 단일 Development Work Item JSON 읽기
- 선택된 작업 항목 검증
- 구현 계획 생성
- 변경 파일/작업 권고 생성
- Agent Result JSON 반환
- 변경 파일, 테스트, 리스크, 권고사항 포함

다음 단계로 미룰 항목:

- GitHub Issue 자동 생성
- 실제 코드베이스 직접 수정
- Pull Request 생성
- 지속 실행 에이전트
- 서버 API 연동

## 4. 입력 형식

### 4.1 Full Collaboration Package

Product Builder의 Agent Collaboration Board에서 내보낸다.

예상 최상위 구조:

```json
{
  "projectId": "string",
  "projectTitle": "string",
  "exportedAt": "string",
  "projectContext": {},
  "handoffInputs": {},
  "workItems": [],
  "agentRuns": [],
  "approvals": [],
  "reviewChecklist": []
}
```

### 4.2 Development Work Item

Agent Collaboration Board의 단일 개발 작업 카드에서 내보낸다.

예상 구조:

```json
{
  "id": "work_dev_1",
  "agentRole": "developer",
  "source": "development.tasks",
  "title": "string",
  "description": "string",
  "status": "ready",
  "priority": "high|medium|low|must_have|should_have|could_have",
  "inputArtifacts": [],
  "acceptanceCriteria": [],
  "blockedBy": [],
  "expectedOutput": {}
}
```

## 5. 출력 형식

개발 에이전트는 Product Builder가 가져올 수 있는 Agent Result JSON을 반환해야 한다.

최소 유효 출력:

```json
{
  "agentRole": "developer",
  "workItemId": "work_dev_1",
  "status": "pass",
  "findings": [
    "구현 계획이 준비되었습니다."
  ],
  "recommendedChanges": [
    "데이터베이스 영속화 전에 /api/projects 엔드포인트 경계를 먼저 정의하세요."
  ],
  "changedFiles": [],
  "tests": [],
  "risks": [
    "대상 코드베이스가 연결되지 않아 실제 파일은 수정하지 않았습니다."
  ],
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

## 6. 개발 에이전트 책임

### 6.1 컨텍스트 이해

읽어야 할 항목:

- `projectContext`
- `handoffInputs.prd`
- `handoffInputs.development`
- `handoffInputs.validation`
- 선택된 work item
- 이전 `agentRuns`

파악해야 할 내용:

- 의도한 MVP 동작
- 관련 API/데이터 모델/페이지 요구사항
- 완료 기준
- 알려진 검증 리스크
- 의존성 또는 차단 요소

### 6.2 구현 계획 작성

각 작업 항목에 대해 다음을 작성한다.

- 요약
- 가정
- 영향을 받을 가능성이 있는 파일 또는 모듈
- 단계별 구현 계획
- 테스트 계획
- 리스크
- 열린 질문

### 6.3 선택적 코드베이스 실행

나중에 대상 코드베이스가 연결되면 개발 에이전트는 다음을 수행할 수 있다.

- 저장소 구조 파악
- 파일 수정
- 테스트/빌드 실행
- 변경 파일 보고

첫 MVP에서는 필수 범위가 아니다.

### 6.4 결과 패키징

개발 에이전트는 항상 가져오기 가능한 JSON으로 종료해야 한다.

차단된 경우에도 다음과 같이 반환한다.

```json
{
  "agentRole": "developer",
  "workItemId": "work_dev_1",
  "status": "blocked",
  "findings": [],
  "recommendedChanges": [],
  "changedFiles": [],
  "tests": [],
  "risks": [
    "대상 저장소가 제공되지 않았습니다."
  ],
  "approvalGate": "requires_user_decision"
}
```

## 7. 권장 로컬 폴더 구조

이 저장소 내부에 구현할 경우:

```text
agents/
  development-agent/
    README.md
    agent.md
    schemas/
      collaboration-package.schema.json
      development-work-item.schema.json
      agent-result.schema.json
    examples/
      collaboration-package.example.json
      work-item.example.json
      result.example.json
    scripts/
      validate-input.mjs
      create-result-template.mjs
```

향후 별도 도구로 분리할 경우:

```text
development-agent/
  src/
    index.ts
    loadPackage.ts
    validate.ts
    planWorkItem.ts
    result.ts
  test/
    validate.test.ts
    result.test.ts
```

## 8. 프롬프트 계약

System prompt:

```text
당신은 시니어 소프트웨어 개발 에이전트입니다.
제품 기획 산출물을 실행 가능한 구현 계획으로 변환합니다.
MVP 범위를 지키고, 관련 없는 기능을 추가하지 않으며, 차단 요소를 명확히 보고해야 합니다.
반드시 유효한 Agent Result JSON 객체를 반환하세요.
```

User prompt template:

```text
프로젝트 컨텍스트:
{{projectContext}}

PRD:
{{handoffInputs.prd}}

Development Package:
{{handoffInputs.development}}

Validation Package:
{{handoffInputs.validation}}

선택된 Work Item:
{{workItem}}

작업:
구현 계획을 작성하고 Agent Result JSON을 반환하세요.
```

## 9. 검증 규칙

실행 전 검증:

- 전체 패키지에 `handoffInputs`가 있어야 한다.
- work item의 `agentRole`은 `developer`여야 한다.
- work item ID가 패키지의 `workItems`에 존재해야 한다.
- work item 상태는 `ready`, `exported`, `in_review` 중 하나인 것이 좋다.

반환 전 검증:

- `agentRole`은 `developer`
- `workItemId`는 선택된 work item과 일치
- `status`는 `pass`, `needs_revision`, `blocked`
- `findings`, `recommendedChanges`, `changedFiles`, `tests`, `risks`는 배열
- `approvalGate`는 `approved` 또는 `requires_user_decision`

## 10. 구현 단계

### 10.1 에이전트 문서 생성

생성할 파일:

```text
agents/development-agent/README.md
agents/development-agent/agent.md
```

문서화할 내용:

- 입력 패키지 형식
- work item 형식
- 출력 result 형식
- 예시 워크플로우

### 10.2 예시 파일 추가

예시 JSON 파일:

```text
agents/development-agent/examples/collaboration-package.example.json
agents/development-agent/examples/work-item.example.json
agents/development-agent/examples/result.example.json
```

### 10.3 검증 스크립트 추가

생성할 파일:

```text
agents/development-agent/scripts/validate-input.mjs
agents/development-agent/scripts/create-result-template.mjs
```

`validate-input.mjs` 역할:

- package JSON 로드
- work item JSON 로드
- work item이 developer 작업인지 확인
- work item이 package에 존재하는지 확인
- 검증 결과 출력

`create-result-template.mjs` 역할:

- work item JSON 로드
- Agent Result JSON 시작 템플릿 생성

### 10.4 Product Builder 안내 추가

README 또는 docs에 다음 사용 흐름을 설명한다.

- Full Collaboration Package JSON 내보내기
- 단일 developer work item JSON 내보내기
- 두 파일을 개발 에이전트에 전달
- 결과 JSON을 Product Builder로 다시 가져오기

### 10.5 테스트 추가

스크립트를 구현한다면 다음을 테스트한다.

- 유효한 package + work item
- 존재하지 않는 work item
- validator work item 거부
- result template 필수 필드 포함

## 11. 현재 MVP용 Agent Result 예시

```json
{
  "agentRole": "developer",
  "workItemId": "work_dev_1",
  "status": "pass",
  "findings": [
    "작업 항목은 구현을 시작하기에 충분한 PRD와 개발 컨텍스트를 포함합니다.",
    "첫 구현은 저장소와 API 경계를 작게 유지하는 것이 좋습니다."
  ],
  "recommendedChanges": [
    "선택된 work item이 설명하는 엔드포인트 또는 모듈을 구현하세요.",
    "작업 완료 전 최소 하나의 검증 단계를 추가하세요.",
    "첫 구현에서는 MVP 외 기능을 제외하세요."
  ],
  "changedFiles": [],
  "tests": [
    "대상 저장소가 연결되지 않아 자동 테스트는 실행하지 않았습니다."
  ],
  "risks": [
    "대상 코드베이스를 확인한 뒤 구현 세부사항이 달라질 수 있습니다."
  ],
  "approvalGate": "approved"
}
```

## 12. 향후 확장

- 대상 Git 저장소 연결
- 구현 브랜치 생성
- GitHub Issue 또는 Linear 티켓 생성
- 테스트 실행 및 로그 첨부
- Pull Request 요약 생성
- 여러 work item 일괄 실행
- 모델별 프롬프트 변형
- 패키지 전달과 결과 가져오기를 위한 서버 API

## 13. 검증 체크리스트

수동 워크플로우:

1. Product Builder에서 프로젝트 생성
2. Agent Collaboration Board 열기
3. Full Collaboration Package JSON 내보내기
4. Development Work Item JSON 하나 내보내기
5. 개발 에이전트에서 두 파일 검증
6. Agent Result JSON 생성
7. Product Builder로 Agent Result JSON 가져오기
8. 다음 항목 확인:
   - work item 상태 변경
   - agent run 표시
   - 결정 로그 추가
   - 권고사항이 변경 로그에 표시

자동 확인:

```powershell
node --check agents/development-agent/scripts/validate-input.mjs
node --check agents/development-agent/scripts/create-result-template.mjs
node --test
```
