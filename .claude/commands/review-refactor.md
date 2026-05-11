# Review Refactoring Opportunities

You are a senior TypeScript architect reviewing the cleancentive monorepo for refactoring opportunities. Produce a structured findings report, then apply fixes.

## Baseline metrics

Before making any changes, capture baseline code quality. Save the output for comparison later.

1. Run `bun lint 2>&1 | tail -20` — record the error and warning counts (per workspace)
2. Run `bun test 2>&1 | tail -20` — record the test count and pass/fail status

## Setup

Load project conventions for context:

1. Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for project conventions and guardrails
2. Read [docs/domain-glossary.md](docs/domain-glossary.md) for canonical terms (Spot vs Pick, Steward vs Admin, detection vs analysis, etc.)
3. Skim [docs/architecture/](docs/architecture/) for the C4 view and data model

Then read source files in scope:

- `backend/src/**/*.ts` (NestJS modules: controllers, services, entities, guards, pipes, DTOs)
- `frontend/src/**/*.{ts,tsx}` (React components, hooks, stores, API clients)
- `worker/src/**/*.ts` (BullMQ consumer + ML/image pipeline)

Skip generated files, migrations, and `*.spec.ts`/`*.test.ts` for the initial pass.

## Check categories

Run each check below. For each finding, record: `{file, line, severity, category, message}`.

### 1. Duplicate functions (severity: warning)

- **Geo helpers** — distance, bbox, hotspot bucketing — find duplicates between `backend/src/`, `frontend/src/`, and `worker/src/`. Cross-workspace duplication is acceptable only if the workspaces cannot share a module; otherwise flag.
- **S3 / object-storage helpers** — key construction (`spots/<userId>/<spotId>/...`), MIME detection, presigned URL builders. Backend and worker may both build keys; flag if their conventions diverge.
- **Magic-link / token helpers** — token generation, hashing, redemption checks. Must live in one place.
- **Error response shapers** — repeated `throw new HttpException({...})` shapes across NestJS controllers — flag candidates for a shared exception filter or helper.
- **Frontend API client wrappers** — repeated axios instances, header construction, retry logic, error normalization across feature modules.
- **Date/time formatting** — find duplicate formatters across React components.
- Any other functions with identical or near-identical bodies across files.

### 2. Repeated structural patterns (severity: warning)

- **NestJS controller try/catch** — controllers that all do `try { return await service.x() } catch (e) { logger.error... throw new HttpException }`. Suggest a global exception filter or interceptor.
- **Multer upload handling** — file-size, MIME, count checks repeated in `spot.controller.ts` and any other upload endpoint. Flag candidates for a shared `FileInterceptor` config or `ParseFilePipe` rules.
- **BullMQ enqueue + status persistence** — controllers/services that push a job, write a status row, and return a job ID. Flag if a `JobsService.enqueue<T>(...)` would consolidate.
- **TypeORM repository CRUD shapes** — services that all do `findOneByOrFail`/`create`/`save` in the same shape. Don't over-abstract trivial CRUD; only flag where the same multi-step write repeats 3+ times.
- **React modal scaffolding** — `AboutModal`, `FeedbackModal`, `ConfirmDialog`, and any other modals share open/close state, focus trap, backdrop click. Flag for a shared `<Modal>` primitive if not already present.
- **Zustand store boilerplate** — repeated patterns for loading/error state across stores.

### 3. Overly complex functions (severity: warning)

- Functions longer than ~60 lines that mix multiple concerns — flag with specific decomposition suggestions.
- Identify the largest functions in `worker/src/` (image pipeline + ML detection) and suggest extractable concerns (download, decode, detect, persist, thumbnail).
- React components longer than ~150 lines or with 5+ `useState` calls — suggest extracting hooks or splitting components.
- Deeply nested control flow (3+ levels of nesting) — flag and suggest flattening with early returns.

### 4. Dead code and unused exports (severity: info)

- Exported functions/types/components that are never imported elsewhere. AGENTS.md forbids barrel files, so unused exports are real signal — not just re-export noise.
- Unreachable code branches (conditions that can never be true based on call sites).
- Variables assigned but never read. Parameters prefixed with `_` are intentional — skip those.
- `console.log` left in production paths.
- Commented-out code blocks.

### 5. Module boundary improvements (severity: info)

- **Controllers containing business logic** — anything beyond request parsing, validation, and delegating to a service. NestJS convention: keep controllers thin.
- **Entities with logic that belongs in services** — methods on entities that touch external systems or other entities.
- **Frontend components doing API orchestration** — multi-step API calls or data shaping in a component instead of a hook/store.
- **Cross-workspace boundary violations** — e.g., worker importing from backend or vice versa. Shared code should be duplicated or extracted to a top-level shared module (note: this repo does not have a shared workspace yet — flag if one would help, but don't propose creating it casually).
- Surprising or circular dependency patterns.

### 6. Data structure consolidation (severity: info)

- **Spot / Pick / detection-result shapes** — built inline at each call site vs. via a factory or DTO. List every place each shape is constructed and flag if a constructor/factory would help.
- **API response shapes** — the same envelope reshaped in multiple controllers vs. a shared DTO.
- **Domain enums spread across files** — e.g., spot statuses, role names — verify they live in one place.

### 7. Simplification opportunities (severity: info)

- Independent `await`s in sequence that could use `Promise.all`.
- Conversely, places where sequential execution is required but `Promise.all` is used (correctness check — flag as warning if found).
- Read-then-write patterns where TypeORM `upsert` or a single `save` would suffice.
- React `useEffect` chains that could be a single derived value or a `useMemo`.
- `JSON.parse(JSON.stringify(x))` for cloning — suggest `structuredClone`.

## Output format

Produce a Markdown report with this structure:

```
## Refactoring Review — {date}

### Summary
- Warnings: {count}
- Info: {count}
- Estimated total refactoring effort: {low/medium/high}

### Warnings
#### {category}: {title}
**Files:** {file1}, {file2}, ...
**Lines:** {file1}:{n}, {file2}:{n}
{Description of the duplication/complexity and concrete refactoring suggestion}

### Info / Opportunities
#### {category}: {title}
**Files:** {file1}, {file2}, ...
{Description and suggestion}

### Recommendations
{Prioritized list of refactoring actions, grouped by effort (quick wins vs. larger changes), with estimated impact on maintainability}
```

Be context-aware: if two functions look similar but serve intentionally different purposes (e.g., backend persisted state vs. frontend optimistic UI state, app-as-user vs. app-as-system contexts), explain WHY they are similar rather than blindly flagging them. Only flag genuinely consolidatable code. Respect the YAGNI / single-responsibility / no-premature-abstraction guidance in CONTRIBUTING.md — do not propose abstractions that exist only to be reused once.

## Apply changes

After completing the review, implement all fixes from the "Warnings" section and any quick-win items from "Info / Opportunities". Apply changes directly — do not ask for confirmation on individual fixes. Match the surrounding style. Do not rename existing symbols unless the rename is the fix. Do not bundle unrelated changes.

## Post-refactoring verification

After all changes are applied, run only the workspaces you touched (faster than the full monorepo):

- Backend touched: `bun run --filter '@cleancentive/backend' lint && bun run --filter '@cleancentive/backend' test`
- Frontend touched: `bun run --filter '@cleancentive/frontend' lint && bun run --filter '@cleancentive/frontend' test`
- Worker touched: `bun run --filter '@cleancentive/worker' lint && bun run --filter '@cleancentive/worker' test`

If you touched 2+ workspaces, run `bun lint && bun test` from the repo root.

ESLint must have zero errors (warnings acceptable if pre-existing). All tests must pass and the count must be >= baseline.

## Metrics comparison

End the review with a before/after comparison table:

```
### Code Metrics — Before vs After

| Metric                        | Before | After | Delta |
|-------------------------------|--------|-------|-------|
| ESLint errors (backend)       |        |       |       |
| ESLint errors (frontend)      |        |       |       |
| ESLint errors (worker)        |        |       |       |
| ESLint warnings (total)       |        |       |       |
| Test count                    |        |       |       |
| Tests passing                 |        |       |       |
```

If ESLint errors increased or tests fail, fix the issues before finishing.
