# Infrastructure

This directory contains the production deployment bundle, bootstrap guidance, validation scripts, and CI/CD definitions for the Cleancentive Hetzner VPS.

## Target architecture

- Single Hetzner VPS running `caddy`, `frontend`, `backend`, `worker`, `postgres`, and `redis`
- External providers for transactional email (`Resend`) and object storage (`Backblaze B2`)
- Production desired state locked in `infrastructure/docker-compose.prod.yml`
- Images published to GHCR and pinned by full 40-character git commit SHA tags
- Production reconciliation triggered by GitHub Actions over SSH, with a low-frequency fallback timer on the server

## Prerequisites

### Server

- Ubuntu or equivalent Linux server
- SSH access with a key-backed admin account
- Docker Engine and Docker Compose plugin installed
- Ports `80` and `443` reachable publicly
- Enough disk for Postgres, Redis, Docker images, and backups

### GitHub and registry

- Repository hosted on GitHub
- GitHub Actions enabled
- GHCR publishing enabled for this repository
- Production deploy key or SSH key stored in GitHub Actions secrets

### Providers

- Domain and DNS administered by the Cleancentive team
- Resend account and verified sending domain
- Backblaze B2 bucket and application key

### Secrets

- Production `.env` stored in the private repository at `cleancentive/cleancentive-private`
- Public repo never stores production secrets
- The production server fetches the current private `.env` during reconciliation

## Branch and versioning model

- `main` is the only branch used for deployment state
- `infrastructure/docker-compose.prod.yml` is the production lock file
- Each production image reference must use a full 40-character git commit SHA tag
- A human promotes a build by updating image tags in `infrastructure/docker-compose.prod.yml`
- CI/CD never commits back into the repository

Example image reference:

```yaml
image: ghcr.io/cleancentive/cleancentive-backend:0123456789abcdef0123456789abcdef01234567
```

## Sparse deploy bundle

The production server does not need to clone the whole repository. It only needs:

- `infrastructure/docker-compose.prod.yml`
- `infrastructure/caddy/Caddyfile`
- the private `.env`

These files are downloaded into a runtime directory and applied with Docker Compose.

## Production flow

1. A push lands on `main`
2. GitHub Actions inspects all changed files in the push (`before..after`)
3. CI builds and publishes only the affected component images
4. If the deploy bundle changed, CI validates the production compose file
5. If validation passes, CI triggers reconciliation on the VPS over SSH
6. The VPS downloads the sparse deploy bundle and private `.env`
7. The VPS validates desired state, skips if already applied, or runs `docker compose pull && docker compose up -d`

## Monorepo change detection rules

### Build backend image

Triggered by changes in:

- `backend/**`
- `package.json`
- `bun.lock`
- `backend/Dockerfile`
- `.dockerignore`

### Build frontend image

Triggered by changes in:

- `frontend/**`
- `package.json`
- `bun.lock`
- `frontend/Dockerfile`
- `.dockerignore`

### Build worker image

Triggered by changes in:

- `worker/**`
- `package.json`
- `bun.lock`
- `worker/Dockerfile`
- `.dockerignore`

### Trigger production reconcile

Triggered by changes in:

- `infrastructure/docker-compose.prod.yml`
- `infrastructure/caddy/Caddyfile`

### No-op changes

These should not build or deploy on their own:

- `docs/**`
- `README.md`
- `backend/README.md`
- `worker/README.md`
- local development helpers that do not affect production, including:
  - `infrastructure/docker-compose.dev.yml`
  - `infrastructure/setup-umami.ts`
  - `infrastructure/init-umami-db.sql`

Umami is currently part of the development stack only. Changes to the Umami dev setup do not imply production deploys unless the production bundle is explicitly updated.

## Production compose validation

`infrastructure/docker-compose.prod.yml` is validated in two places:

- pre-commit hook when that file changes
- reconcile script on the server before applying the new desired state

Validation checks:

- every image reference uses a full 40-character SHA tag
- every referenced image tag exists in GHCR
- no floating tags such as `latest`, `main`, or `prod`

Install the shared git hook locally with:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit infrastructure/scripts/*.sh
```

## Runtime directories on the server

Recommended paths:

- `/opt/cleancentive/deploy/docker-compose.prod.yml`
- `/opt/cleancentive/deploy/caddy/Caddyfile`
- `/opt/cleancentive/private/.env`
- `/opt/cleancentive/state/` for applied checksums and reconcile markers
- `/etc/cleancentive/reconcile.env` for `PRIVATE_ENV_URL`, `PRIVATE_ENV_TOKEN`, and optional overrides

See `infrastructure/env/reconcile.env.example` for the expected host-level reconcile variables.

## Bootstrap responsibilities

Bootstrap should install and configure only the host baseline:

- Docker Engine and Compose plugin
- runtime directories under `/opt/cleancentive`
- systemd service and timer units
- optional backup timer

Bootstrap should not perform ongoing application deploys. Steady-state deployment is done by the reconcile script.

## Rollback

Rollback is a normal git change:

1. Edit `infrastructure/docker-compose.prod.yml`
2. Replace the affected image tag(s) with the previous known-good SHA(s)
3. Push to `main`
4. CI validates and triggers reconcile

## Files in this directory

- `docker-compose.dev.yml`: local development dependencies, including Umami
- `docker-compose.prod.yml`: locked production topology and promoted image tags
- `caddy/Caddyfile`: production edge proxy configuration
- `scripts/validate-prod-compose.sh`: production image-tag validation
- `scripts/reconcile.sh`: sparse-download and reconcile entrypoint for the VPS
- `env/reconcile.env.example`: example systemd environment file for reconciliation
- `systemd/*.service` and `systemd/*.timer`: host-managed automation units
