---
description: Pick an open feedback plan, implement it, archive locally, and close upstream
---

Implement an open feedback plan end-to-end. Pause after each step. Complements `/triagato`, which only triages — `/implementato` actually ships a fix.

## Configuration

Same env routing as `/triagato`. Default target is production.

| Argument | Base URL |
|----------|----------|
| _(none)_, `prod` | `https://cleancentive.org` |
| `dev`, `development`, `local`, `localhost` | `https://localhost:5173` |
| Any other value | Use as-is |

| Setting | Value |
|---------|-------|
| API path | `{base_url}/api/v1` |
| Token file | `infrastructure/.feedback-token.{env}` |
| Plans directory | `docs/feedback-plans/{env}/` |
| Archive directory | `docs/feedback-plans/{env}/fixed/` |

## Step 1: Authenticate

Same as `/triagato` step 1: load `infrastructure/.feedback-token.{env}`. If missing or expired, run the device-code flow. Refresh if expiring within 30 days.

## Step 2: Scan open plans

Glob `docs/feedback-plans/{env}/*.md` (top-level only — exclude `fixed/`). Read frontmatter from each. Keep only items where `status` is `open` or `planned` (skip `implemented` and `wont-fix`).

If zero plans match, report "No open plans for {env}." and stop.

## Step 3: Present overview

Sort the matched plans by:
1. **severity**: `critical` > `high` > `medium` > `low`
2. **prod_status**: `in_progress` > `acknowledged` > `new` (already-started items first)
3. **age**: oldest `created` first

Print a compact table:

| # | id (8 chars) | sev | cat | age | prod | title |
|---|--------------|-----|-----|-----|------|-------|

`age` is days since `created`. `cat` is the first letter of `category` (b/s/q).

Pick the top row as the **recommended next**. If multiple items have the same severity and at least one is `in_progress` upstream, prefer that one (continuation beats starting fresh).

Report: "Recommended next: `{short id}` — {title}. Reason: {one short sentence}."

## Step 4: User selects

Prompt: "Choose a plan to implement — type the row number, an 8+ char id prefix, or press enter to accept the recommendation. Type `cancel` to abort."

Pause. Wait for input. Resolve to a single plan file path. If ambiguous prefix, list candidates and prompt again.

## Step 5: Mark in_progress

Confirm with the user before any upstream call: "About to set feedback `{id}` to `in_progress` upstream and start implementation. Proceed? (y/n)"

On approval:

1. `PATCH {base_url}/api/v1/feedback/{id}/status` with body `{ "status": "in_progress" }` and `Authorization: Bearer {token}`.
2. Update the plan frontmatter:
   - `status: planned`
   - `prod_status: in_progress`
   - `last_updated: {today UTC}`

Report success or any API error. If the API call fails, ask whether to continue with local-only changes.

## Step 6: Detailed planning phase

Re-read the plan file and treat its existing **Implementation Plan** as a starting point, not the final answer. Run a fresh planning round:

- Spawn Explore agents in parallel to verify the plan's assumptions still hold (files referenced exist, code paths haven't shifted).
- Ask the user clarifying questions via `AskUserQuestion` if requirements or scope are unclear.
- Refine the plan: drop steps that no longer apply, add anything missing, list concrete file paths and the existing utilities to reuse.
- Update the **Implementation Plan**, **Files to Modify**, and any **Analysis** sections of the plan file in place — this file is the canonical record.
- Use `ExitPlanMode` to request approval before writing code.

## Step 7: Implement

After plan approval, implement the changes. Follow project conventions:

- Bun, not npm/yarn. Monorepo workspaces: `backend/`, `frontend/`, `worker/`.
- Run typecheck and tests in each touched workspace.
- For UI changes, start the dev server and verify in a browser per [CLAUDE.md](CLAUDE.md). If a browser test isn't possible, say so explicitly.

## Step 8: User acceptance

Pause and ask: "Implementation done. Verify it works (run, click through, etc.) and tell me when you're ready to ship."

Wait for an explicit go-ahead. If the user reports issues, loop back to Step 7.

## Step 9: Commit with closure tag

Stage only the files actually changed (no `git add -A`). Draft a commit message in the project's style — short conventional-commit subject, body explaining the why. **The body must include `Fixes {full-feedback-id}`** (case-insensitive). This is the trigger the [.github/workflows/close-feedback.yml](.github/workflows/close-feedback.yml) workflow uses on push to `main`.

Show the user the proposed commit message and the file list. On approval, commit.

Do **not** push — pushing is the user's call, and pushing triggers the upstream closure workflow.

## Step 10: Wrap up

For prod (`cleancentive.org`), closure is handled by CI on push — do **not** run `scripts/close-feedback.ts` locally. When the user pushes `main`, [.github/workflows/close-feedback.yml](.github/workflows/close-feedback.yml) parses the `Fixes {id}` tag from the commit body and runs the script with the org-scoped token. It archives the plan to `fixed/`, updates frontmatter, posts the closure comment, sets upstream status to `resolved`, and commits the moved plan back to `main` as `chore(feedback): mark resolved tickets [skip ci]`.

For non-prod environments there is no equivalent CI workflow. Pause and ask the user whether they want to close upstream manually (the plan file move + frontmatter update + `POST /feedback/{id}/responses` + `PATCH /feedback/{id}/status` to `resolved`). Do nothing without explicit approval.

Report what was done:

- Files changed and the commit short SHA
- For prod: a reminder that `git push origin main` will trigger CI to archive the plan and close upstream
- For non-prod: whether upstream was updated and the new plan file location

## Notes

- `/implementato` only calls upstream itself in Step 5 (set `in_progress`). All closure writes happen via CI on push to `main` — implementato never closes upstream from the developer machine for prod.
- The plan file in `docs/feedback-plans/{env}/` is the canonical implementation record — refine it in Step 6 rather than working from a scratch plan.
- If the user wants to drop a plan as `wont-fix` instead of implementing it, that's out of scope for this command — they should edit the frontmatter manually.
