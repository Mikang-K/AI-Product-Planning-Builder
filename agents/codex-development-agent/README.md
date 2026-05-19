# Codex Development Agent

Product Builder가 생성한 개발 work item을 Codex 작업으로 넘기기 위한 파일 기반 MVP입니다.

## 입력

- Codex Development Package JSON
- 또는 Product Builder가 생성한 Codex Prompt Markdown

## 출력

Product Builder의 `Result Import`로 다시 가져올 수 있는 Agent Result JSON입니다.

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

## 사용법

프롬프트 생성:

```powershell
node agents/codex-development-agent/scripts/create-codex-prompt.mjs `
  agents/codex-development-agent/examples/codex-development-package.example.json `
  agents/codex-development-agent/examples/codex-prompt.generated.md
```

결과 검증:

```powershell
node agents/codex-development-agent/scripts/validate-codex-result.mjs `
  agents/codex-development-agent/examples/codex-result.example.json
```

## 작업 원칙

- 저장소 구조를 먼저 파악합니다.
- 선택된 work item의 MVP 범위만 구현합니다.
- 변경한 파일과 실행한 테스트를 결과 JSON에 기록합니다.
- 테스트를 실행하지 못했다면 그 이유를 `risks` 또는 `codexEvidence.notes`에 남깁니다.
- 위험한 삭제, 리셋, 배포는 사용자 승인 없이 수행하지 않습니다.
