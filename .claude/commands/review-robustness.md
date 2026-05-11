# Review Robustness, Scalability, and Error Handling

You are a production reliability engineer reviewing cleancentive's backend and worker for robustness. The app accepts user-uploaded photos, stores them in S3, runs ML detection in a BullMQ worker, and serves a public read API for the map. It must scale to many concurrent users uploading large images, with the worker keeping pace. Produce a structured findings report.

## Setup

Before reviewing, load project context:

1. Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for project conventions
2. Read [docs/domain-glossary.md](docs/domain-glossary.md) for canonical terms
3. Skim [docs/architecture/](docs/architecture/) for the data model and component diagram

Then read source files in scope (skip frontend for this review):

- `backend/src/**/*.ts` (NestJS modules, especially controllers, services, guards, pipes, exception filters, BullMQ producers, TypeORM repositories)
- `worker/src/**/*.ts` (BullMQ consumer, image pipeline, ML detection client, S3 I/O)
- `backend/src/migrations/*.ts` (only when reasoning about schema integrity)
- `infrastructure/docker-compose*.yml` (only when reasoning about resource limits / topology)

## Check categories

Run each check below. For each finding, record: `{file, line, severity, category, message}`.

### 1. Error handling coverage (severity: error)

- Every outbound HTTP / `fetch` / `httpService` call must check status and handle non-2xx responses — find any that do not.
- Every controller method must either be wrapped in a global exception filter OR have explicit try/catch returning a structured error — find any that throw uncaught exceptions to the Nest runtime in a way that would leak internals.
- Every BullMQ job handler must catch per-item errors so a single bad item does NOT kill the whole batch (or, conversely, must intentionally fail-fast — confirm the choice is explicit).
- TypeORM repository calls (`findOneByOrFail`, `save`, `update`) — verify error paths handle `EntityNotFoundError`, unique-constraint violations, and connection drops.
- S3 client calls — verify network errors, 4xx (auth/permissions), and 5xx (transient) are differentiated.
- Multer / `FileInterceptor` errors — verify they produce a clean 4xx, not a 500.

### 2. Error context and logging (severity: warning)

- Every `Logger.error()` should include enough context to debug in production: at minimum the operation name and the entity ID (`spotId`, `userId`, `jobId`, `pickId`, etc.).
- Find `logger.error(err)` calls that lack entity context.
- Find operations that silently swallow errors (return `false`/`null`/`undefined` without logging).
- Verify `logger.warn` is used for non-fatal partial failures vs `logger.error` for actual failures.
- **No secrets in logs** — magic-link tokens, raw JWTs, OIDC client secrets, bcrypt hashes, presigned-URL signatures must not appear. `userId` and `email` are acceptable; full request bodies are not (could contain tokens).
- Stack traces should be in server logs but never in HTTP responses.

### 3. Scalability — query and pagination (severity: error)

- **Map bbox queries** — `/api/v1/spots?bbox=...` and any insights aggregation must use spatial indexes (PostGIS GIST). Confirm via the entity / migration that the index exists. Confirm the query uses `ST_Within` / `ST_Intersects` and not a function on the indexed column that would defeat the index.
- **Cursor or offset pagination** — every list endpoint that can return >100 items must paginate. `take`/`skip` is fine for small offsets; for large datasets prefer keyset pagination. Flag unbounded list endpoints.
- **N+1 queries** — TypeORM `relations: [...]` vs lazy loading: walk relevant services and flag suspected N+1 patterns. Use `QueryBuilder` with explicit joins where lists carry related entities.
- **Insights / aggregation endpoints** — flag full table scans; recommend materialized views or denormalized counters if needed.
- **Worker DB pressure** — the worker connects directly to Postgres. Verify pool sizing in `worker/src/` is bounded and won't starve the API's pool.

### 4. Scalability — pipeline operations (severity: warning)

- **Image processing memory** — `sharp` operations: are large source images decoded fully into memory? For 20MP+ phone photos, flag if streaming or downscaling early would help.
- **Worker concurrency** — BullMQ `concurrency` setting per queue: verify it's tuned (not 1, not unbounded). Cross-check with worker container memory limits in `docker-compose.prod.yml`.
- **Sequential vs batched writes** — multi-step writes per spot (insert spot → upload image → insert thumbnail → enqueue job) — flag if any could be batched in a single transaction.
- **In-memory growth** — Sets/Maps/arrays that accumulate over a job lifetime — estimate memory footprint at peak load.

### 5. Resilience and retry logic (severity: warning)

- **BullMQ idempotency** — workers may retry on failure. Verify each job handler is idempotent: re-running a partially completed job should not duplicate side effects (no duplicate S3 keys, no double-counted detection results, no duplicate detection rows for the same spot).
- **Retry policy** — verify `attempts`, `backoff`, and `removeOnComplete`/`removeOnFail` are configured deliberately on each queue, not left at defaults.
- **Magic-link single-use** — verify token redemption marks the token consumed atomically and a second redemption fails cleanly.
- **S3 upload partial failure** — if the spot row is inserted but S3 upload fails, what state is left? Flag if there's no compensating action (delete row or mark spot as failed).
- **Detection write-back race** — if the worker writes detection results while the user updates the spot (e.g., deletes it), what wins? Flag missing optimistic locking or clear ordering.
- **Outbound timeouts** — every external call (SMTP, OIDC, OpenAI/ML, S3) needs a sane timeout — flag missing timeouts.

### 6. Data integrity (severity: error)

- **Multi-step writes without a transaction** — e.g., creating a spot + writing detection rows + enqueuing a job. If step 2 fails, step 1 must be rolled back or compensated. Use TypeORM `@Transactional()` / `dataSource.transaction(...)`.
- **Foreign-key cascades** — verify ON DELETE behavior is intentional. Soft-deleting a user should not orphan spots silently.
- **Race conditions on counters** — any `findOne → mutate → save` on a shared counter is a lost-update bug. Use atomic SQL `UPDATE ... SET count = count + 1` or row-level locks.
- **Migration safety** — schema changes that require a backfill: verify the migration is online-safe (no exclusive locks on large tables, no NOT NULL without a default on big tables). Flag risky migrations.
- **BullMQ job state vs DB state** — if Redis is wiped, what's lost? Verify there is a way to reconcile or re-enqueue.

### 7. Edge cases (severity: warning)

- **Spot deleted between enqueue and worker pickup** — does the worker fail loudly or silently?
- **User revokes consent / deletes account mid-flow** — are in-flight jobs and uploads handled?
- **Offline IndexedDB sync** — frontend may submit a spot whose client-generated ID collides or whose `createdAt` is in the future. Flag missing server-side validation/normalization.
- **PostGIS edge cases** — antimeridian crossings, identical points, null geography.
- **OIDC role sync** — what happens if the OIDC provider is down at login time? Flag missing graceful degradation.
- **EXIF / image edge cases** — corrupt EXIF, missing GPS, rotated images.

### 8. Resource limits (severity: info)

- **Multer file size cap** — confirm the cap is set and matches the documented user expectation. Confirm rejection produces a clean 4xx.
- **Postgres connection pool** — backend pool size + worker pool size should not exceed `max_connections`. Verify the math.
- **Redis memory** — BullMQ retains completed/failed jobs by default. Verify `removeOnComplete` / `removeOnFail` retention is bounded.
- **SMTP** — Mailpit (dev) is fine; in prod, verify SES/SendGrid send-rate caps and the magic-link send-rate per IP/user.
- **Bun runtime quirks** — flag any Node-only API used (e.g., `cluster`, certain stream behaviors) that could behave differently under Bun.

## Output format

Produce a Markdown report with this structure:

```
## Robustness Review — {date}

### Summary
- Errors: {count}
- Warnings: {count}
- Info: {count}
- Overall risk assessment: {low/medium/high} with rationale

### Errors (must fix)
#### [{category}] {title}
**File:** {file}:{line}
**Impact:** {what goes wrong in production}
**Recommendation:** {specific fix}

### Warnings (should fix)
#### [{category}] {title}
**File:** {file}:{line}
**Impact:** {what goes wrong at scale}
**Recommendation:** {specific fix}

### Info (consider)
#### [{category}] {title}
**File:** {file}:{line}
**Note:** {observation and suggestion}

### Risk Matrix
| Area              | Current State | Risk at 1K spots/day | Risk at 100K spots/day |
|-------------------|---------------|----------------------|------------------------|
| Map bbox queries  | ...           | ...                  | ...                    |
| Worker throughput | ...           | ...                  | ...                    |
| S3 / upload       | ...           | ...                  | ...                    |
| Error recovery    | ...           | ...                  | ...                    |
| Data integrity    | ...           | ...                  | ...                    |

### Recommendations
{Prioritized list with estimated effort and impact, ordered by risk severity}
```

Be context-aware: cleancentive is a Bun + NestJS + BullMQ stack on Docker Compose, not a serverless platform. Standard Node/Nest idioms (DI, `Logger`, exception filters, interceptors) are the expected patterns — do not flag them as missing if they are in place. Focus on issues that would manifest in production at scale.

## Apply changes

After completing the review, implement all fixes from the "Errors" and "Warnings" sections. Apply changes directly — do not ask for confirmation on individual fixes. Respect AGENTS.md: do not bundle unrelated changes; if a fix requires a schema change, add a migration in `backend/src/migrations/` following the existing naming convention.

After all changes are applied, run only the workspaces you touched:

- Backend touched: `bun run --filter '@cleancentive/backend' lint && bun run --filter '@cleancentive/backend' test`
- Worker touched: `bun run --filter '@cleancentive/worker' lint && bun run --filter '@cleancentive/worker' test`
- Both: `bun lint && bun test` from the repo root.
