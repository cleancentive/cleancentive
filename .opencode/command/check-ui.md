---
description: Verify UI state in the shared browser using Playwright MCP tools
---

Use the Playwright MCP tools to check the current UI state in the shared browser.

## Available services

| Service | URL |
|---------|-----|
| Frontend app | http://localhost:5173 |
| API docs (Swagger) | http://localhost:3000/api/ |
| Email testing (Mailpit) | http://localhost:8025 |
| Object storage (MinIO) | http://localhost:9001 |

## Workflow

1. Navigate to the relevant URL using `browser_navigate`
2. Take a screenshot using `browser_screenshot` to see the current state
3. If the user described a specific interaction, perform it (click, fill, etc.)
4. Take another screenshot after interaction to verify the result
5. Report what you see — describe the UI state, any errors, or unexpected behavior

## Notes

- The browser must be running (`bun browse`) for MCP tools to work
- You and the human share the same browser — they can see your actions in real time
- Prefer `browser_snapshot` (accessibility tree) for reading text content, `browser_screenshot` for visual layout
- If the MCP tools fail to connect, ask the human to run `bun browse` first
