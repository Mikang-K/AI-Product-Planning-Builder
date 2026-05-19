# Development Agent

Product Builder의 `Agent Collaboration Board`에서 내보낸 협업 패키지와 개발 작업 항목을 입력으로 받아, 외부 개발 자동화 에이전트가 수행할 작업을 검증하고 결과 JSON 템플릿을 만드는 파일 기반 MVP입니다.

## 입력

필수 입력 파일:

- Full Collaboration Package JSON
- Development Work Item JSON

Product Builder에서 다음 순서로 내보냅니다.

1. 프로젝트 생성
2. `에이전트` 탭 열기
3. `Full JSON` 내보내기
4. 개발 작업 카드의 `Export Item`으로 work item JSON 내보내기

## 출력

Product Builder가 다시 가져올 수 있는 Agent Result JSON입니다.

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

## 사용법

입력 검증:

```powershell
node agents/development-agent/scripts/validate-input.mjs `
  agents/development-agent/examples/collaboration-package.example.json `
  agents/development-agent/examples/work-item.example.json
```

결과 템플릿 생성:

```powershell
node agents/development-agent/scripts/create-result-template.mjs `
  agents/development-agent/examples/work-item.example.json `
  agents/development-agent/examples/result.generated.json
```

## 검증 규칙

- collaboration package에는 `handoffInputs`와 `workItems`가 있어야 합니다.
- work item의 `agentRole`은 `developer`여야 합니다.
- work item의 `id`는 collaboration package의 `workItems` 안에 존재해야 합니다.
- work item 상태는 `ready`, `exported`, `in_review` 중 하나를 권장합니다.

## 현재 범위

이 MVP는 파일 검증과 결과 템플릿 생성을 담당합니다. 실제 코드 수정, GitHub Issue 생성, Pull Request 생성은 다음 단계에서 다룹니다.
