# Agent Instructions

You are working on Cleancentive, an environmental cleanup and litter tracking application.

**Read [CONTRIBUTING.md](CONTRIBUTING.md) first.** All code quality principles and project conventions there apply to you.

## Before You Code

- Read [docs/domain-glossary.md](docs/domain-glossary.md) for canonical terminology. Use these terms in code, UI text, and documentation.
- Check `docs/architecture/` for architecture documentation (C4 diagrams, data models).
- Check existing code in the relevant workspace for patterns before creating new ones.

## Code Generation Standards

- Do not generate placeholder or stub implementations. Every function must do something real or not exist yet.
- Do not add TODO comments unless explicitly asked. Either implement it or leave it out.
- Do not wrap simple operations in unnecessary abstractions.
- Do not create barrel files (index.ts re-exports) unless one already exists in that directory.
- Do not add dependencies without being asked. Use what is already in package.json.
- Prefer inline types over creating type files for types used in only one place.

## File and Module Conventions

- Backend follows NestJS module structure: `src/<domain>/<domain>.{module,controller,service,entity}.ts`
- Frontend follows feature-based structure under `src/`
- Worker scripts go in `worker/src/`
- Test files live adjacent to source: `*.spec.ts` for unit tests, `test/` directory for e2e tests

## When Modifying Existing Code

- Match the style of the surrounding code, even if you would write it differently.
- Do not reformat or restructure files beyond the scope of the requested change.
- Do not rename existing variables, functions, or files unless that is the task.
- When fixing a bug, add a test that reproduces it before fixing it.

## Commits and PRs

- Follow the conventional commit format specified in CONTRIBUTING.md.
- One logical change per commit. Do not bundle unrelated changes.
- Keep PRs focused. If you discover something unrelated that needs fixing, note it separately.

## Database Migrations

- Production uses `migrationsRun: true` — it does **not** use `synchronize`. Every schema change must have a migration.
- When adding or modifying an entity, create a corresponding migration in `backend/src/migrations/`.
- Follow the existing naming convention: `<timestamp>-<Description>.ts` (e.g. `1767000000000-AddPendingAuthAndFeedback.ts`).
- `synchronize: true` only runs in dev. Never rely on it to verify that production will work.

## Infrastructure and Deployment

- Never make ad-hoc changes on the production server via SSH. All server state must be reproducible.
- Scripts, systemd units, and server configuration are managed by `infrastructure/scripts/idempotato`. To change server state, update the source files and run idempotato in apply mode.
- Production secrets and runtime env vars live in the `cleancentive-private` repo. Push changes there to trigger the ship-production-env workflow.
- Use `idempotato --no-fry <host>` to verify server state matches desired state without making changes.
- Image tags in `infrastructure/docker-compose.prod.yml` must use full 40-character git commit SHAs. Only promote tags for commits that actually built images (check CI).

## Local Dev Bootstrap

The whole dev stack is designed to come up from a fresh machine with two commands:

```
bun dev      # starts infra + backend + frontend + worker
bun browse   # opens the shared Chromium with all dev tabs
```

`bun dev` chains through preflight scripts that provision what's needed:

1. [infrastructure/check-hosts.ts](infrastructure/check-hosts.ts) — ensures `/etc/hosts` maps `cleancentive.local`, `wiki.cleancentive.local`, `analytics.cleancentive.local`, and `host.docker.internal` to `127.0.0.1`. Prompts for sudo interactively; prints the command on non-TTY.
2. [infrastructure/setup-certs.ts](infrastructure/setup-certs.ts) — ensures mkcert + its local CA are installed and a cert for `*.cleancentive.local` exists at `infrastructure/certs/`. On macOS it offers to `brew install mkcert nss` automatically. On Linux it prints install commands (too many distro variants to auto-install safely).
3. `docker compose … up -d` — brings up Postgres, Redis, MinIO, Mailpit, Caddy (TLS termination on :443 with mkcert certs), Umami, Outline (wiki).
4. [infrastructure/setup-umami.ts](infrastructure/setup-umami.ts) — creates the "Cleancentive Dev" website in Umami and writes the ID into `frontend/.env.local`.

**Never add a step that requires the dev to run a one-off command manually.** If you're tempted to document "also run X once", instead make `bun dev` run X idempotently. Exception: system-level installs on Linux (we print commands for those).

Dev URLs all use HTTPS with trusted certs — geolocation permissions, service workers, and `Secure` cookies all behave as they would in prod:

| Service | Dev URL |
|---|---|
| App (frontend + `/api/*`) | `https://cleancentive.local` |
| Wiki (Outline) | `https://wiki.cleancentive.local` |
| Analytics (Umami) | `https://analytics.cleancentive.local` |
| Mailpit / MinIO / pgweb | `http://localhost:<port>` (dev-only, kept on plain ports) |

## Browser Tools (MCP)

Coding agents can interact with the shared development browser via the Playwright MCP server.

**Prerequisites:** Start the shared browser with `bun browse` before using browser tools.

The MCP server connects to the running browser on CDP port 9222 and provides tools for:
- Taking screenshots of the current page
- Navigating to URLs
- Clicking elements, filling forms, reading page content
- Evaluating JavaScript in the page context

The browser must be running — the MCP server attaches to it, it does not launch its own.
Agent and human share the same browser; changes are visible to both.

**Screenshots and traces go in `.playwright-mcp/`** (already gitignored). When calling `browser_take_screenshot`, `browser_start_tracing`, `browser_start_video`, or any tool that takes a `filename`, prefix the path with `.playwright-mcp/` — e.g. `.playwright-mcp/wiki-sso.png`. Do not write browser artefacts to the project root.
