# Code Review Agent

File-based MVP for reviewing Product Builder development work.

## Input

Required files:

- Full Collaboration Package JSON
- Review Work Item JSON

The review work item must use:

```json
{
  "agentRole": "reviewer"
}
```

## Output

Product Builder-compatible Agent Result JSON:

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
      "description": "The changed behavior is not covered.",
      "recommendation": "Add a focused test before approval."
    }
  ],
  "recommendedChanges": [],
  "changedFiles": [],
  "tests": [],
  "risks": [],
  "approvalGate": "requires_user_decision"
}
```

## Usage

Validate input:

```powershell
node agents/code-review-agent/scripts/validate-input.mjs package.json review-work-item.json
```

Create a result template:

```powershell
node agents/code-review-agent/scripts/create-result-template.mjs review-work-item.json result.json
```
