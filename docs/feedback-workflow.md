# Feedback workflow

When a commit fixes a tracked feedback item, mention it in the commit body:

```
fix(cleanups): store cleanup dates as timestamptz with explicit offsets

Fixes 019decd2
```

The match is case-insensitive — `Fix`, `fix`, `Fixes`, `FIXES` all work — and an 8+ character prefix of the feedback UUID is enough.

## What happens on push to `main`

[.github/workflows/close-feedback.yml](../.github/workflows/close-feedback.yml) scans new commits in the push and, for each `Fix(es) <id>` tag, runs [scripts/close-feedback.ts](../scripts/close-feedback.ts) which:

- updates the matching plan file's frontmatter — `status: implemented`, `fixed_at`, `closure_commits: [<short-sha>]`
- moves the file to `docs/feedback-plans/cleancentive.org/fixed/`
- posts a response on cleancentive.org linking back to the commit
- patches the upstream feedback to `status: resolved`
- commits the local changes back to `main` as `github-actions[bot]` with `[skip ci]`

The script is idempotent: if a SHA is already in `closure_commits`, it skips the move and the API calls.

## Manual close

For commits that landed before the workflow existed, run the script locally:

```
bun scripts/close-feedback.ts <sha> [<sha>...]
```

Add `--dry-run` to preview without touching files or hitting the API. The script reads the same token (`infrastructure/.feedback-token.cleancentive.org`) that `triagato` writes, so no extra setup.

## One-time setup — repo secret

The workflow needs a long-lived admin JWT for cleancentive.org as the `FEEDBACK_TOKEN_CLEANCENTIVE_ORG` GitHub Actions secret:

```
gh secret set FEEDBACK_TOKEN_CLEANCENTIVE_ORG < infrastructure/.feedback-token.cleancentive.org
```

The token comes from the `triagato` device-code flow — see [.claude/commands/triagato.md](../.claude/commands/triagato.md) Step 1.
