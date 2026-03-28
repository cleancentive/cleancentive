---
description: Guide a production deployment — check CI, compare images, and update the prod compose file
---

Walk through the production deployment checklist step by step. Pause after each step to report findings before moving on.

## Step 1: Check GitHub Actions

Run `gh run list --branch main --limit 5` to see recent workflow runs.

- If any run is `in_progress` or `queued`, report it and poll with `gh run watch <id>` until it completes.
- If the latest run failed, report the failure and stop — the user needs to fix CI before deploying.
- If all recent runs succeeded, proceed.

## Step 2: Compare pinned vs latest images

Run `infrastructure/scripts/promoto --status` to see which services are behind.

- Report the status table to the user.
- If all services are up to date, tell the user there is nothing to deploy and stop.

## Step 3: Propose compose file update

If any services are behind, ask the user whether to promote all behind services or only specific ones.

Once confirmed, run `infrastructure/scripts/promoto --apply` (optionally with `--service <name>` if the user chose a subset).

Show the resulting diff with `git diff infrastructure/docker-compose.prod.yml`.

## Step 4: Validate

Run `infrastructure/scripts/validate-prod-compose.sh` to confirm all image tags exist in GHCR.

Report the result. If validation passes, suggest the user commit and push to trigger reconciliation.

## Notes

- Images are tagged with full 40-character git SHAs — never use floating tags.
- Reconciliation is triggered automatically by GitHub Actions when `docker-compose.prod.yml` changes on main.
- Do not commit or push without explicit user confirmation.
