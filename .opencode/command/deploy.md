---
description: Guide a production deployment — check CI, promote built images, validate compose, and trigger reconcile
---

Walk through the production deployment checklist step by step. Pause after each step to report findings before moving on.

## Step 1: Check GitHub Actions

Run `gh run list --branch main --limit 5` to see recent workflow runs.

- If any run is `in_progress` or `queued`, report it and poll with `gh run watch <id>` until it completes.
- If the latest run failed, report the failure and stop — CI must be fixed before deploying.
- If all recent runs succeeded, proceed.

## Step 2: Compare Pinned vs Latest Cleancentive Images

Run `infrastructure/scripts/promoto --status` to see which Cleancentive services are behind.

- Report the status table to the user.
- `promoto` only promotes Cleancentive images: `backend`, `frontend`, and `worker`.
- Third-party images, such as Outline pinned by digest, are validated by `validate-prod-compose.sh` but are not promoted by `promoto`.
- If all services are up to date, continue to Step 4 if private env or deploy-bundle changes still need reconciliation; otherwise tell the user there is nothing to deploy and stop.

## Step 3: Promote Built Images

If any services are behind, ask the user whether to promote all behind services or only specific ones.

- For backend-only code changes, prefer `infrastructure/scripts/promoto --apply --service backend`.
- For frontend-only changes, prefer `--service frontend`.
- For worker-only changes, prefer `--service worker`.
- For cross-cutting changes, promote all behind services with `infrastructure/scripts/promoto --apply`.

Once confirmed, run the selected `promoto --apply` command.

Show the resulting diff with:

```bash
git diff infrastructure/docker-compose.prod.yml
```

## Step 4: Check Private Env Changes

Check whether the private production env repo has pending changes:

```bash
git -C /Users/matthias/git/cleancentive-private status --short
```

- If `cleancentive-private/.env` changed, report that it must be committed and pushed as part of the deploy.
- Do not print secret values.
- Do not commit or push the private repo without explicit user confirmation.

## Step 5: Validate

Run production validation:

```bash
infrastructure/scripts/validate-prod-compose.sh infrastructure/docker-compose.prod.yml
PRIVATE_ENV_FILE=/Users/matthias/git/cleancentive-private/.env docker compose --env-file /Users/matthias/git/cleancentive-private/.env -f infrastructure/docker-compose.prod.yml config --quiet
bash -n infrastructure/scripts/reconcile.sh infrastructure/scripts/validate-prod-compose.sh
```

Report the result. If validation fails, stop and fix the issue before deploying.

## Step 6: Commit and Push Plan

Summarize the public and private repo diffs.

Ask for explicit confirmation before committing or pushing anything.

Recommended order:

1. Commit and push public repo changes.
2. Wait for CI to build images for the new main SHA.
3. Re-run this command to promote the newly built image(s) into `infrastructure/docker-compose.prod.yml`.
4. Commit and push the compose promotion.
5. Commit and push `cleancentive-private/.env` changes, if any.
6. Let GitHub Actions trigger production reconcile.

## Step 7: Post-Deploy Verification

After reconcile completes, verify the relevant production surfaces.

For the Outline/Cleancentive integration, check:

- `https://cleancentive.org` loads.
- `https://wiki.cleancentive.org` loads Outline.
- SSO login into the wiki succeeds.
- Logout → SSO re-login does not blank-screen.
- Backend logs show integration queue/bootstrap activity without repeated failures.
- Team wiki links open the expected Outline collection.
- Wiki pageviews appear in Umami.

## Notes

- Cleancentive images are tagged with full 40-character git SHAs — never use floating tags.
- Third-party production images must be pinned by digest when used in prod compose.
- Reconciliation is triggered automatically by GitHub Actions when `docker-compose.prod.yml` changes on `main`.
- Production env shipping uses the `cleancentive-private` repo. Never print secret values.
- Do not commit or push without explicit user confirmation.
