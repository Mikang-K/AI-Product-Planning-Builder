# Codex 기반 개발 워크플로우 구현 계획

## 1. 목표

현재 프로젝트는 Product Builder에서 기획 산출물을 만들고, Agent Collaboration Board에서 개발 work item을 생성한 뒤, 파일 기반 Development Agent를 통해 입력 검증과 Agent Result JSON 생성을 지원한다.

다음 단계의 목표는 개발 과정을 Codex 기반으로 수행할 수 있도록 연결하는 것이다.

## 구현 상태

2026-05-19 기준으로 파일 기반 Codex 개발 워크플로우 MVP 구현을 완료했다.

구현된 항목:

- `src/codexWorkflow.js`
- `test/codexWorkflow.test.mjs`
- `agents/codex-development-agent/README.md`
- `agents/codex-development-agent/prompt-template.md`
- `agents/codex-development-agent/schemas/*.json`
- `agents/codex-development-agent/examples/*.json`
- `agents/codex-development-agent/scripts/create-codex-prompt.mjs`
- `agents/codex-development-agent/scripts/validate-codex-result.mjs`
- Agent Collaboration Board의 `Codex Package` 액션
- Agent Collaboration Board의 `Codex Prompt` 액션
- Agent Result Import의 `codexEvidence` 보존

검증 완료 항목:

- Codex Development Package 생성
- Codex Prompt 생성
- Codex Result 검증
- Codex Result를 Product Builder Agent Result로 가져오기
- 전체 `node --test` 통과

즉, Product Builder가 만든 개발 작업을 Codex가 이해할 수 있는 작업 패키지로 변환하고, Codex가 실제 저장소에서 구현과 검증을 진행한 뒤, 결과를 다시 Product Builder에 가져올 수 있게 한다.

목표 흐름:

```text
Product Builder
  -> PRD / Development Package / Work Item 생성
  -> Codex Development Package 생성
  -> Codex 작업 실행
  -> 코드 수정 / 테스트 / 검증
  -> Codex Result JSON 생성
  -> Product Builder Result Import
  -> work item / agentRuns / automationRuns 갱신
```

## 2. 현재 상태

이미 구현된 기반:

- Agent Collaboration Board
- Development Work Item 생성
- Collaboration Package JSON 내보내기
- Development Agent 입력 검증 CLI
- Agent Result JSON 템플릿 생성 CLI
- Planning-to-Development 자동화 모듈
- `Run Package`
- `Run All Ready Dev`
- Agent Result Import
- automation run 상태 반영

현재 한계:

- 개발 에이전트가 실제 저장소를 수정하지 않는다.
- Codex가 수행할 구체적인 작업 지시 형식이 없다.
- Codex 작업 결과를 검증 증거와 함께 구조화하는 계약이 부족하다.
- 브라우저에서 Codex를 직접 실행할 수 없다.

## 3. 설계 원칙

- Codex는 실제 구현과 검증을 담당하는 개발 실행자 역할을 맡는다.
- Product Builder는 작업 의도, 범위, 완료 기준, 산출물 계약을 제공한다.
- Codex는 사용자 승인 없이 위험한 파일 삭제, 대규모 리셋, 외부 배포를 수행하지 않는다.
- 모든 Codex 작업 결과는 Product Builder의 Agent Result JSON과 호환되어야 한다.
- 코드 변경 결과에는 변경 파일, 실행한 테스트, 남은 리스크가 반드시 포함되어야 한다.
- 첫 구현은 파일 기반 handoff로 시작하고, 이후 로컬 Runner 또는 Codex CLI 연결로 확장한다.

## 4. 전체 아키텍처

```text
Product Builder UI
  -> Codex Package 생성
  -> Codex Prompt 생성
  -> Codex Result Import

src/codexWorkflow.js
  -> Codex 작업 패키지 생성
  -> Codex 프롬프트 생성
  -> Codex 결과 검증

agents/codex-development-agent
  -> README.md
  -> prompt-template.md
  -> schemas/
  -> examples/
  -> scripts/

Codex 실행 환경
  -> 저장소 분석
  -> 구현
  -> 테스트
  -> 결과 JSON 작성
```

## 5. MVP 범위

첫 구현에서 포함할 항목:

- Codex Development Package 스키마 정의
- Codex 작업 프롬프트 템플릿 작성
- Product Builder에서 Codex Package JSON 생성
- Product Builder에서 Codex Prompt Markdown 생성
- Codex Result JSON 스키마 정의
- Codex Result를 기존 Agent Result Import로 변환
- 자동 테스트 추가

첫 구현에서 제외할 항목:

- 브라우저에서 Codex 직접 실행
- Codex CLI 자동 호출
- Git branch 자동 생성
- Pull Request 자동 생성
- 원격 저장소 push
- 배포 자동화

## 6. Codex Development Package

Product Builder가 Codex에 넘길 입력 패키지다.

예상 구조:

```json
{
  "packageType": "codex-development",
  "version": 1,
  "projectId": "project_1",
  "projectTitle": "Sample Project",
  "createdAt": "2026-05-19T00:00:00.000Z",
  "workItem": {
    "id": "work_dev_1",
    "agentRole": "developer",
    "title": "string",
    "description": "string",
    "status": "exported",
    "acceptanceCriteria": []
  },
  "context": {
    "prd": "string",
    "developmentPackage": {},
    "validationPackage": {},
    "projectContext": {},
    "decisionLogs": []
  },
  "implementationContract": {
    "scope": [],
    "outOfScope": [],
    "expectedChangedFiles": [],
    "requiredTests": [],
    "riskChecks": []
  },
  "resultContract": {
    "format": "agent-result-json",
    "requiredFields": [
      "agentRole",
      "workItemId",
      "status",
      "findings",
      "recommendedChanges",
      "changedFiles",
      "tests",
      "risks",
      "approvalGate"
    ]
  }
}
```

## 7. Codex Prompt 계약

Codex에 전달할 프롬프트는 다음 구조를 따른다.

```markdown
# Codex Development Task

## Role

당신은 이 저장소에서 작업하는 시니어 개발 에이전트입니다.

## Project Context

{{projectContext}}

## PRD

{{prd}}

## Development Package

{{developmentPackage}}

## Selected Work Item

{{workItem}}

## Acceptance Criteria

{{acceptanceCriteria}}

## Instructions

1. 저장소 구조를 먼저 파악하세요.
2. 작업 범위를 MVP에 맞게 제한하세요.
3. 필요한 파일만 수정하세요.
4. 테스트 또는 검증 명령을 실행하세요.
5. 결과를 Agent Result JSON으로 작성하세요.

## Output

반드시 Product Builder가 가져올 수 있는 Agent Result JSON을 반환하세요.
```

## 8. Codex Result JSON

Codex의 최종 결과는 기존 Agent Result JSON과 호환되어야 한다.

```json
{
  "agentRole": "developer",
  "workItemId": "work_dev_1",
  "status": "pass",
  "findings": [
    "구현 요약"
  ],
  "recommendedChanges": [
    "후속 권고"
  ],
  "changedFiles": [
    "src/example.js",
    "test/example.test.mjs"
  ],
  "tests": [
    "node --test"
  ],
  "risks": [
    "남은 리스크"
  ],
  "approvalGate": "approved",
  "codexEvidence": {
    "commands": [
      {
        "command": "node --test",
        "status": "pass"
      }
    ],
    "notes": [
      "브라우저 자동화는 현재 실행하지 않았습니다."
    ]
  }
}
```

Product Builder의 기존 import는 필수 필드만 사용하고, `codexEvidence`는 확장 정보로 보관한다.

## 9. 파일 구조

추가할 파일:

```text
src/codexWorkflow.js
test/codexWorkflow.test.mjs

agents/codex-development-agent/
  README.md
  prompt-template.md
  schemas/
    codex-development-package.schema.json
    codex-result.schema.json
  examples/
    codex-development-package.example.json
    codex-result.example.json
  scripts/
    create-codex-prompt.mjs
    validate-codex-result.mjs
```

## 10. Product Builder UI 변경

Agent Collaboration Board에 다음 액션을 추가한다.

- `Codex Package`
- `Codex Prompt`
- `Codex Result Import`

동작:

1. 사용자가 developer work item에서 `Codex Package`를 클릭한다.
2. Product Builder가 Codex Development Package JSON을 다운로드한다.
3. 사용자가 `Codex Prompt`를 클릭하면 Markdown 프롬프트를 다운로드한다.
4. Codex가 작업을 마치고 Agent Result JSON을 작성한다.
5. 사용자가 결과 JSON을 가져오면 work item과 automation run이 갱신된다.

## 11. `src/codexWorkflow.js` 설계

추가할 함수:

```js
export function buildCodexDevelopmentPackage(project, workItem, options = {}) {}
export function buildCodexPrompt(codexPackage) {}
export function normalizeCodexResult(result) {}
export function convertCodexResultToAgentResult(result) {}
export function validateCodexPackage(codexPackage) {}
```

책임:

- Product Builder 산출물을 Codex용 입력으로 변환한다.
- Codex가 이해하기 쉬운 Markdown 작업 프롬프트를 만든다.
- Codex 결과를 기존 Agent Result JSON으로 변환한다.
- 필수 필드 누락과 role/workItem 불일치를 검증한다.

## 12. Codex 작업 절차

Codex는 다음 순서로 작업한다.

1. Codex Development Package를 읽는다.
2. PRD와 Development Package에서 작업 범위를 파악한다.
3. 저장소 구조를 탐색한다.
4. 변경 계획을 간단히 세운다.
5. 구현한다.
6. 테스트 또는 정적 검증을 실행한다.
7. 변경 파일과 테스트 결과를 정리한다.
8. Agent Result JSON을 작성한다.

## 13. 상태 전이

work item 상태:

```text
ready
  -> exported
  -> in_review
  -> pass | needs_revision | blocked
```

Codex package 생성 시:

```text
ready -> exported
```

Codex 작업 시작 시:

```text
exported -> in_review
```

결과 import 시:

```text
in_review -> pass | needs_revision | blocked
```

automation run 상태:

```text
queued -> running -> completed
queued -> running -> failed
```

## 14. 테스트 계획

자동 테스트:

```powershell
node --test
```

추가 테스트:

- Codex Development Package 생성
- developer work item만 패키징 허용
- validator work item 거부
- Codex Prompt에 PRD와 acceptance criteria 포함
- Codex Result를 Agent Result로 변환
- workItemId 불일치 거부
- 필수 결과 필드 누락 거부

수동 테스트:

1. Product Builder에서 프로젝트 생성
2. Agent Collaboration Board 열기
3. developer work item의 `Codex Package` 다운로드
4. `Codex Prompt` 다운로드
5. Codex에게 프롬프트와 패키지 제공
6. Codex가 구현 및 테스트 수행
7. Codex Result JSON 가져오기
8. work item, agentRuns, automationRuns 반영 확인

## 15. 구현 단계

### 15.1 Codex 워크플로우 도메인 모듈 추가

파일:

```text
src/codexWorkflow.js
test/codexWorkflow.test.mjs
```

구현:

- Codex package 생성
- Codex prompt 생성
- Codex result 정규화
- Agent Result 변환

### 15.2 Codex 에이전트 폴더 추가

파일:

```text
agents/codex-development-agent/README.md
agents/codex-development-agent/prompt-template.md
agents/codex-development-agent/schemas/*.json
agents/codex-development-agent/examples/*.json
agents/codex-development-agent/scripts/*.mjs
```

구현:

- 파일 기반 Codex 실행 안내
- 예시 package/result
- prompt 생성 스크립트
- result 검증 스크립트

### 15.3 Product Builder UI 연결

파일:

```text
src/main.js
styles.css
```

구현:

- work item 카드에 Codex package 생성 버튼 추가
- Codex prompt 다운로드 버튼 추가
- 기존 Result Import와 연결

### 15.4 결과 가져오기 확장

파일:

```text
src/automation.js
src/codexWorkflow.js
```

구현:

- Codex Result의 확장 필드 보존
- automation run과 result 연결
- 테스트 증거 표시 준비

### 15.5 향후 Runner 연동

파일:

```text
agents/runner/server.mjs
agents/runner/routes/run-codex-development.mjs
```

역할:

- Product Builder 요청 수신
- Codex package 저장
- Codex 실행 명령 또는 작업 세션 생성
- 결과 JSON 반환

이 단계는 파일 기반 MVP가 안정화된 뒤 진행한다.

## 16. 완료 기준

MVP 완료 기준:

- Product Builder에서 Codex Development Package를 생성할 수 있다.
- Product Builder에서 Codex Prompt Markdown을 생성할 수 있다.
- Codex가 반환한 Result JSON을 기존 Agent Result Import로 가져올 수 있다.
- work item 상태, agentRuns, automationRuns가 갱신된다.
- 관련 테스트가 `node --test`에서 통과한다.

확장 완료 기준:

- 로컬 Runner를 통해 Codex 실행을 요청할 수 있다.
- Codex 실행 결과가 자동으로 Product Builder에 반영된다.
- 변경 파일, 테스트 명령, 리스크가 UI에서 추적된다.
- 실패한 Codex 작업을 재시도할 수 있다.

## 17. 권장 구현 순서

1. `src/codexWorkflow.js` 추가
2. Codex package/prompt/result 테스트 추가
3. `agents/codex-development-agent` 폴더와 예시 파일 추가
4. Product Builder UI에 Codex package/prompt 다운로드 버튼 추가
5. Codex Result Import 검증 강화
6. 전체 테스트 실행
7. 수동 Codex 작업 흐름 검증
8. 로컬 Runner 기반 자동 실행으로 확장
