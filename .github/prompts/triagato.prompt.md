---
description: Fetch open feedback from PROD, sync local plans, classify and analyse new items
---

Triage feedback into local implementation plans. Pause after each step to report findings.

## Configuration

Default target is production. If the user passes an argument (e.g., `/triagato localhost`), override the base URL:

| Argument | Base URL |
|----------|----------|
| _(none)_, `prod` | `https://cleancentive.org` |
| `dev`, `development`, `local`, `localhost` | `https://localhost:5173` |
| Any other value | Use as-is (e.g., `https://staging.example.com`) |

Derive the **environment name** from the hostname of the base URL (e.g., `cleancentive.org`, `localhost`). Plans are stored in `docs/feedback-plans/{env}/`.

| Setting | Value |
|---------|-------|
| API path | `{base_url}/api/v1` |
| Token file | `infrastructure/.feedback-token.{env}` |
| Plans directory | `docs/feedback-plans/{env}/` |
| Won't-fix archive | `docs/feedback-plans/{env}/wontfix/` |

## Step 1: Check authentication

Read `infrastructure/.feedback-token.{env}` (e.g., `.feedback-token.cleancentive.org`). Each environment has its own token since JWT secrets differ. If the file is missing or empty, run the device code flow:

1. `curl -s -X POST {base_url}/api/v1/auth/device-code` → get `{ id, deviceCode, expiresIn }`
2. Tell the user: "Open this URL to authorize: `{base_url}/auth/device?code={deviceCode}`"
3. Open the URL in their browser (use `open` on macOS)
4. Poll `curl -s {base_url}/api/v1/auth/device-code/{id}` every 2 seconds
5. When status is `completed`, save the `sessionToken` to `infrastructure/.feedback-token.{env}`
6. When status is `rejected`, stop and report: "Device code was rejected. Run /triagato again to retry."
7. If 5 minutes pass with no response, stop and ask the user to try again

If the file exists, decode the JWT payload (base64 middle segment) and check the `exp` claim. If expired, run the device code flow above. If expiring within 30 days, refresh via `POST {base_url}/api/v1/auth/refresh`.

## Step 2: Fetch open feedback

Fetch all non-resolved feedback:

```
GET {base_url}/api/v1/feedback?status=new,acknowledged,in_progress&page=1
Authorization: Bearer {token}
```

Paginate by incrementing `page` until `items` returned is fewer than 20. Collect all items.

Report: "Fetched N feedback items from {env}."

## Step 3: Scan existing plans

Glob `docs/feedback-plans/{env}/*.md` (top-level only — exclude `fixed/` and `wontfix/`). For each file, read the YAML frontmatter and extract `feedback_id`, `status`, and `prod_status`.

Report: "Found N existing plan files for {env}."

## Step 4: Gap analysis

Compare fetched items against local plans:

- **Existing plan, feedback still open**: Update `prod_status` if changed. Append any new conversation thread entries. Update `last_synced` to today. If the local plan has `status: implemented` but the feedback is still open upstream, change `status` back to `open` and flag: "Reopened — feedback not yet resolved."
- **No matching plan**: Mark as NEW for analysis in Step 5.
- **Local plan exists but no matching upstream item**: The feedback was resolved or deleted upstream. Update `prod_status: resolved` and `last_synced`.

Report a summary table: plans updated, plans resolved upstream, new items to analyze.

## Step 5: Analyse new feedback

For each NEW feedback item:

1. Read the description and error context
2. Search the codebase for related code: grep for keywords, URLs, component names, or error messages mentioned in the feedback
3. Check existing plan files for similar issues (mention in `related` frontmatter field if found)
4. Classify severity:
   - **critical**: bug with `error_context` containing a stack trace
   - **high**: bug without stack trace
   - **medium**: suggestion
   - **low**: question
5. Draft an implementation plan with specific files and changes
6. Write the plan file to `docs/feedback-plans/{env}/{feedback_id}.md` using this format:

```yaml
---
feedback_id: {id}
title: {short agent-generated summary}
status: open    # open | awaiting-info | planned | implemented | wont-fix
category: {bug|suggestion|question}
severity: {critical|high|medium|low}
prod_status: {new|acknowledged|in_progress}
created: {today ISO date}
last_synced: {today ISO date}
last_updated: {today ISO date}
# awaiting_info_since: {ISO date}   # set only when status is awaiting-info
related: []
---

## Original Feedback
> {description verbatim}

## Error Context
{error_context fields, or "None"}

## Conversation Thread
{responses newest-last, or "No responses yet"}

## Analysis
{agent classification, root cause hypothesis, affected area}

## Implementation Plan
{concrete steps with file paths}

## Files to Modify
- {path/to/file.ts}
```

## Step 6: Decide per-plan and act upstream

For each plan freshly drafted in Step 5, show the user a compact summary — title, severity, and the Implementation Plan condensed to 2–3 lines — then prompt:

> Decide for `{short id}`: **k** keep · **f** needs reporter feedback · **d** discard · **s** skip (decide later). [k]

Default to **k** on empty input. The user may also type `k-all` at any prompt to apply **k** to every remaining new plan in one pass.

| Choice | Local plan effect | Upstream status | Upstream comment |
|--------|-------------------|-----------------|------------------|
| **k** — keep as-is | `status: open` (unchanged) | `acknowledged` | none, unless user supplies one |
| **f** — needs reporter feedback | `status: awaiting-info`, set `awaiting_info_since: {today}` | `acknowledged` | **required** — the steward's question(s) for the reporter |
| **d** — discard | `status: wont-fix`, move file to `docs/feedback-plans/{env}/wontfix/{id}.md` | `resolved` | **required** — short reason the reporter will see |
| **s** — skip (decide later) | `status: open` (unchanged) | unchanged | none |

For **f** and **d**, draft the comment yourself based on the plan's Analysis (for **f**, the gaps that block planning; for **d**, the reason the request is out of scope or already addressed). Show the draft and let the user edit, accept, or cancel. Keep the tone plain and friendly — no jargon, no internal plan IDs, no agent voice.

Before any upstream write, confirm:

> About to set feedback `{id}` to `{status}` upstream{ and post comment}. Proceed? (y/n)

On approval, call in order:

1. `POST {base_url}/api/v1/feedback/{id}/responses` with `{ "message": "{comment}" }` — only if a comment is set.
2. `PATCH {base_url}/api/v1/feedback/{id}/status` with `{ "status": "acknowledged" | "resolved" }`.

Both require `Authorization: Bearer {token}`. If a call fails, report the error and ask whether to apply the local-only changes anyway (so the next `/triagato` run does not re-prompt for the same item).

For **k-all**, apply the **k** branch (status `acknowledged`, no comment) to every remaining new plan after a single confirmation that lists the affected ids.

## Step 7: Report summary

Print a table summarizing all actions taken:

| Action | Count |
|--------|-------|
| New plans created | N |
| Plans updated | N |
| Plans reopened | N |
| Plans resolved upstream (auto-detected) | N |
| Acknowledged upstream (kept) | N |
| Acknowledged upstream with reporter question | N |
| Discarded upstream (resolved with reason) | N |
| Skipped (decision deferred) | N |

## Notes

- The plans directory is gitignored — plans are local working documents, not committed
- This command writes to upstream (status changes and steward comments) — every write is gated on an explicit user confirmation, mirroring `/implementato`
- To implement a plan, the user triggers it manually: "Implement the plan in docs/feedback-plans/{env}/{id}.md"
- After implementing, update the plan's `status` to `implemented` and `last_updated`
