---
description: Run promoto --auto end-to-end deploy and stream its progress
---

Run `infrastructure/scripts/promoto --auto` and let it drive the deploy.

The script reports each phase as it goes — preflight, wait for in-flight CI, status, apply, commit & push, wait for deploy CI, poll the prod version endpoint. Stream its output verbatim. If it aborts, surface the abort line. Do not run any of these steps yourself — promoto is the source of truth.

Override defaults only if the user asks:
- `--prod-url <url>` — default is `https://cleancentive.org/api/v1/version`
- `--timeout <seconds>` — default is 600 per phase
- `--service <name>` — restrict to a single service
