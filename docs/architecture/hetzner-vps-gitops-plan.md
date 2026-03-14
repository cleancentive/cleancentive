# Hetzner VPS GitOps Deployment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Cleancentive to a single Hetzner VPS with declarative, Git-tracked infrastructure while using Resend for email and Backblaze B2 for S3-compatible object storage.

**Architecture:** Keep stateful core services (Postgres/PostGIS and Redis) on the VPS in containers, run frontend/backend/worker behind Caddy, and externalize transactional email plus object storage. Reconcile production from committed manifests and pinned images so server state is reproducible.

**Tech Stack:** Docker Compose, Caddy, NestJS backend, React/Vite frontend, worker service, PostgreSQL/PostGIS, Redis, Resend, Backblaze B2 (S3 API), GitHub Actions (or equivalent CI).

---

## Plan A: What a Human Has To Do

### Task 1: Provider and domain setup

**Output:** Verified provider accounts and DNS ready for production.

- [ ] Buy or confirm the production domain.
- [ ] Create Resend account and verify sending domain.
- [ ] Add email DNS records required by Resend (SPF, DKIM, and DMARC).
- [ ] Create Backblaze B2 bucket for production images.
- [ ] Create Backblaze application key with least privileges needed for the app.
- [ ] Record B2 endpoint/region/bucket/key details in the secret inventory.

### Task 2: VPS provisioning and hardening

**Output:** Secure Hetzner VPS baseline with only required public access.

- [ ] Provision the VPS with enough SSD for app services, Postgres growth, and backups.
- [ ] Create a non-root deploy user and disable password SSH logins.
- [ ] Install system updates and enable unattended security upgrades.
- [ ] Configure firewall to allow only `22`, `80`, and `443`.
- [ ] Restrict SSH access by key and source CIDR where possible.
- [ ] Configure DNS `A/AAAA` records to point to the VPS.

### Task 3: Secrets and access control

**Output:** Production secrets exist outside git with a clear owner and rotation process.

- [ ] Create strong secrets for app auth/session and database credentials.
- [ ] Store all production secrets in a root-owned env file path outside the repository.
- [ ] Grant minimum access to production credentials.
- [ ] Document who can rotate which credential.
- [ ] Schedule credential rotation checkpoints (for example every 90 days).

### Task 4: Backup and recovery commitments

**Output:** Explicit RPO/RTO and tested restore process.

- [ ] Decide backup target (local + offsite preferred).
- [ ] Set retention policy for Postgres backups.
- [ ] Define RPO (acceptable data loss window) and RTO (acceptable recovery time).
- [ ] Run at least one restore drill to a non-production database.
- [ ] Record restore outcomes and gaps in deployment docs.

### Task 5: Launch gate and operations ownership

**Output:** Go-live approval with named on-call owner and health checks in place.

- [ ] Confirm owner for production incidents.
- [ ] Confirm who can trigger deploys and rollbacks.
- [ ] Approve launch checklist: HTTPS, login email flow, uploads, worker queue, backups.
- [ ] Approve first-month monitoring cadence (daily quick checks, weekly deeper review).

---

## Plan B: What a Coding Agent Has To Do

### Task 1: Create declarative infrastructure layout

**Files:**
- Create: `infrastructure/compose/docker-compose.prod.yml`
- Create: `infrastructure/caddy/Caddyfile`
- Create: `infrastructure/env/app.env.example`
- Create: `infrastructure/env/postgres.env.example`
- Create: `infrastructure/env/redis.env.example`

- [ ] Define services: `caddy`, `frontend`, `backend`, `worker`, `postgres`, `redis`.
- [ ] Define named volumes for persistent state.
- [ ] Define private network boundaries and expose only proxy ports publicly.
- [ ] Add health checks and restart policies for all services.
- [ ] Keep all runtime configuration env-driven (no hardcoded credentials/endpoints).

### Task 2: Make email and storage provider-locked by config

**Files:**
- Modify: `backend/src/email/*`
- Modify: `backend/src/spot/*`
- Modify: `worker/src/index.ts`
- Modify: `backend/.env.example`

- [ ] Implement or finalize a thin email abstraction with provider selection via env.
- [ ] Lock production provider to `Resend` while keeping adapter boundary for future swaps.
- [ ] Ensure object storage uses S3-compatible config only.
- [ ] Set Backblaze B2 values through `S3_*` environment variables.
- [ ] Add startup validation for required production env vars.

### Task 3: Build and release immutable images in CI

**Files:**
- Create: `.github/workflows/build-and-push-images.yml`
- Modify: repo Dockerfiles for `frontend`, `backend`, `worker`

- [ ] Build versioned images for frontend, backend, and worker on merge to main branch.
- [ ] Push images to a registry with immutable tags (for example commit SHA).
- [ ] Publish image tags as deploy metadata/artifacts.
- [ ] Keep deploy manifests referencing pinned tags, not floating `latest`.

### Task 4: Implement pull-and-reconcile deployment on VPS

**Files:**
- Create: `infrastructure/systemd/cleancentive-deploy.service`
- Create: `infrastructure/systemd/cleancentive-deploy.timer`
- Create: `docs/deployment/operations.md`

- [ ] Add a server-side deploy command that pulls repo config and reconciles compose state.
- [ ] Ensure startup order handles migrations safely before backend traffic cutover.
- [ ] Ensure services auto-start after VPS reboot.
- [ ] Document manual deploy and rollback commands.

### Task 5: Add backup automation and operational runbooks

**Files:**
- Create: `infrastructure/scripts/postgres-backup.sh`
- Create: `infrastructure/systemd/postgres-backup.service`
- Create: `infrastructure/systemd/postgres-backup.timer`
- Create: `docs/deployment/backup-restore.md`
- Create: `docs/deployment/bootstrap-checklist.md`

- [ ] Automate daily Postgres backup with retention pruning.
- [ ] Document exact restore procedure and verification steps.
- [ ] Add launch verification checklist for end-to-end smoke tests.
- [ ] Document incident playbook (service down, email failure, storage auth failure, disk pressure).

### Task 6: Verify production readiness before cutover

**Verification commands (examples):**
- `docker compose -f infrastructure/compose/docker-compose.prod.yml config`
- `docker compose -f infrastructure/compose/docker-compose.prod.yml ps`
- `curl -f https://<your-domain>/api/v1/health`
- `curl -I https://<your-domain>/`

- [ ] Verify HTTPS and proxy routing.
- [ ] Verify magic-link email delivery through Resend.
- [ ] Verify image upload and retrieval through Backblaze B2.
- [ ] Verify worker processes queued detection jobs.
- [ ] Verify backup job execution and restore viability.

---

## Year-1 Scope Guardrails

- Keep a single VPS topology; do not introduce Kubernetes.
- Keep frontend on the same VPS for now.
- Keep Postgres and Redis local unless operational pain or growth justifies managed migration.
- Re-evaluate architecture after first customer quarter or when utilization materially increases.
