# Local Codex Runner

Product Builder에서 생성한 Codex Prompt를 실제 `codex exec` 실행으로 연결하는 로컬 전용 Runner입니다.

## 실행

```powershell
node agents\runner\server.mjs
```

기본 주소:

```text
http://127.0.0.1:4173
```

Runner는 정적 앱과 API를 함께 제공합니다. 브라우저에서는 위 주소로 접속하면 됩니다.

## API

```text
GET  /api/runner/health
POST /api/codex-runs
GET  /api/codex-runs/:id
GET  /api/codex-runs/:id/logs
GET  /api/codex-runs/:id/result
```

## 산출물

실행 결과는 `.agent-runs/` 아래에 저장됩니다.

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

## 안전 정책

- `127.0.0.1`에서만 listen합니다.
- Codex는 `workspace-write` sandbox로 실행합니다.
- `danger-full-access`는 사용하지 않습니다.
- 결과 JSON이 유효하지 않으면 `blocked` 결과로 변환합니다.
