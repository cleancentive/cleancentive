# Data Workflows — Export, Import, Backup & Synthetic Generation

This document covers how CleanCentive moves application data around: exporting and
importing the database + object storage (full **and** incremental), running
backup/restore drills, and generating realistic synthetic datasets.

All tools share one **bundle format**, so a synthetic dataset and a real export are
interchangeable: you can restore a backup, then layer synthetic scenario packs on top.

By default, bundles land in a git-ignored **`data/`** folder at the repo root, with
auto-generated names that encode the source, timestamp, and whether the bundle is a
full snapshot or an incremental delta. The tooling uses that folder to decide whether
to export incrementally and to replay a restore chain.

> **Paths are repo-root-relative.** Every path flag (`--output`, `--input`, `--spec`,
> `--labels-from`, `--output-root`) is resolved against the **repo root**, regardless
> of where you run the command from. So `--output data/x` and the default `data/`
> location always mean `<repo>/data/...`. (The `data:*` aliases run the scripts inside
> the `backend/` workspace via `--filter`, but path resolution is anchored to the repo
> root so this is transparent.) Use absolute paths to write elsewhere.

> **Scope boundary.** These workflows cover the **19 application-data tables**
> (litter/community data + the `spot_edits` audit trail). They intentionally do
> **not** cover authentication/session tables (`device_codes`,
> `pending_auth_requests`), OIDC tables, or Outline-wiki integration tables. Those
> are ephemeral or externally provisioned: users re-authenticate after a restore
> (passwordless / OIDC re-issues tokens), and Outline state is recreated by
> `infrastructure/setup-outline.ts`. A "full backup" here means all application data,
> not literally every row in Postgres.

## Commands

Convenience aliases live in the root `package.json` and delegate to the backend
scripts. Pass script flags after a `--` separator:

| Command | What it does |
| --- | --- |
| `bun run data:export -- [--full \| --incremental]` | Export to `data/` — auto-incremental when a prior bundle exists, else full |
| `bun run data:backup -- ` | Force a **full** snapshot into `data/` |
| `bun run data:import -- --input <dir> --mode <replace\|merge>` | Import a single bundle |
| `bun run data:restore -- [--source <label>]` | Rebuild the DB from the latest full + its increments (chain) |
| `bun run data:generate -- [--spec <file>] [...]` | Generate a synthetic bundle (see below) |

The underlying scripts can also be run directly from the `backend/` workspace
(`cd backend && bun run db:export -- ...`, `db:import`, `db:generate`) — path
resolution is identical (repo-root-relative).

## Bundle format (the contract)

A bundle is a directory, by default `data/<source>-<YYYYMMDD-HHMMSS>-<full|incr>/`
(e.g. `data/local-20260530-164512-full/`):

```
<bundle>/
  manifest.json
  <table>.ndjson          # one JSON object per line, in dependency order
  images/<s3-key>         # mirrors S3 keys, e.g. images/spots/<id>/original-<uploadId>.jpg
                          # (present only when `spots` is in scope and images aren't skipped)
```

`manifest.json` (version 2):

```json
{
  "version": 2,
  "type": "full",                       // or "incremental"
  "bundle_id": "local-20260530-164512-full",
  "source_label": "local",              // from DB_HOST (localhost → "local")
  "since": null,                        // incremental lower bound (null for full)
  "high_watermark": "2026-05-30 16:45:12.123456",
  "parent": null,                       // bundle_id this increment builds on
  "exported_at": "2026-05-30T16:45:12.000Z",
  "source_database": "cleancentive",
  "source_host": "localhost",
  "scope": ["labels", "users", "teams", "cleanups", "spots", "feedback"],
  "tables": { "spots": { "row_count": 600 }, "spot_edits": { "row_count": 41 } },
  "images": { "downloaded": 1200, "failed": 0, "skipped": false }
}
```

`db-import` accepts **version 1** (legacy, always full) and **version 2** bundles.

**Stability guarantee.** Any bundle producer must emit this shape: the `scope` array,
a per-table `row_count`, and the optional `images` block. Each `<table>.ndjson` row's
key set must match the live table columns — the importer derives the column list from
the **first row only**, so every row in a file must have identical keys. Timestamps
are preserved as raw strings; `jsonb` columns (`detection_raw`, `error_context`) are
stored as JSON objects (not pre-stringified).

### Scope groups → tables

| Group | Tables |
| --- | --- |
| `labels` | `labels`, `label_translations` |
| `users` | `users`, `user_emails`, `admins` |
| `teams` | `teams`, `team_email_patterns`, `team_memberships`, `team_messages` |
| `cleanups` | `cleanups`, `cleanup_dates`, `cleanup_participants`, `cleanup_messages` |
| `spots` | `spots`, `detected_items`, `detected_item_edits`, `spot_edits` |
| `feedback` | `feedback`, `feedback_responses` |

Tables are inserted in topological (forward) order and truncated in reverse. Hard FK
dependencies are auto-expanded: `teams`, `cleanups`, and `spots` all pull in `users`.

## Export (full & incremental)

```bash
bun run data:export                 # auto: incremental if a prior bundle exists, else full
bun run data:export -- --full       # force a full snapshot  (alias: data:backup)
bun run data:export -- --incremental # force incremental (errors if no compatible base)
```

Flags:

- `--full` / `--incremental` — force the mode (default is auto).
- `--output-root <dir>` — folder that holds auto-named bundles (default: `data/`).
- `--output <dir>` — write to exactly this dir instead of an auto name (one-off).
- `--scope <groups>` — subset of `users, teams, cleanups, spots, labels, feedback`, or `all` (default).
- `--no-images` — skip downloading S3 images.

**How incremental works.** Each export records a `high_watermark` (the DB clock at
export start). An incremental export selects only rows changed in
`(base.high_watermark, now]`, using each table's watermark column — `updated_at` for
most tables, `created_at` for the append-only audit tables (`spot_edits`,
`detected_item_edits`). It only downloads images for the spots in that delta. A bundle
is an eligible **base** for the next incremental when it has the same `source_label`
and the same `scope`.

Connection env vars (dev defaults): `DB_HOST=localhost`, `DB_PORT=5432`,
`DB_USERNAME=cleancentive`, `DB_PASSWORD=…`, `DB_DATABASE=cleancentive`;
`S3_ENDPOINT=http://localhost:9002`, `S3_REGION=us-east-1`,
`S3_BUCKET=cleancentive-images`, `S3_ACCESS_KEY=minioadmin`, `S3_SECRET_KEY=minioadmin`.

> **Deletes are not captured by increments.** A watermark sees inserts and updates,
> not hard deletes (admin spot purge, account deletion, worker re-detection replacing
> `detected_items`, …). So an incremental chain is **additive**: replaying it keeps
> rows that were deleted at the source after the last full. To reconcile deletions,
> take a fresh **full** snapshot (`data:backup`). Recommended routine: a periodic full
> (e.g. daily/weekly) plus frequent increments between them.

## Import

### Single bundle

```bash
bun run data:import -- --input data/<bundle> --mode <replace|merge>
```

- `replace` — `TRUNCATE … CASCADE` the in-scope tables (reverse order), then insert.
  The bundle becomes authoritative for its scope.
- `merge` — upsert `ON CONFLICT (id) DO UPDATE`. Additive and idempotent (used for
  synthetic packs and applying increments).
- `--scope <groups>`, `--no-images`, `--dry-run`, and `--target-is-production` (below).

### Chain restore (full + increments)

```bash
bun run data:restore                       # = db:import --chain  (default --input data/)
bun run data:restore -- --source local     # pick a source when data/ holds several
bun run data:restore -- --merge-base        # apply the full via merge too (no truncate)
```

`--chain` discovers bundles under `--input` (default `data/`), resolves the latest
**full** for the source plus every increment taken after it, and applies them in order:
the full via `replace`, each increment via `merge`. `--source <label>` is required only
when multiple sources are present. `--dry-run` prints the ordered chain without writing.

**FK handling.** Replace/chain set `session_replication_role = 'replica'` to defer FK
checks during the transaction (needs an elevated DB role); if unavailable, a two-pass
fallback NULLs the circular `users` columns (`active_team_id`,
`active_cleanup_date_id`, `avatar_email_id`) then restores them. Merge mode alone does
not defer FKs, so a merge-only bundle must not contain forward references unsatisfiable
in insert order (the synthetic generator leaves those `users` columns NULL).

## Backup / restore runbook

### (a) Full backup

```bash
# Point DB_*/S3_* at the source (dev defaults, or prod env for a prod backup).
bun run data:backup                 # full snapshot → data/<source>-<ts>-full/
```

Verify `manifest.json` has `type: "full"`, all six scope groups, sensible
`row_count`s, and that `images/` is populated. Remember the scope boundary above.

### (b) Restore into a fresh dev database

The scripts assume the schema already exists (they never create tables).
`synchronize` is **off**; schema comes from migrations, which run automatically when
the backend boots.

```bash
# 1. Bring up infra (empty Postgres + MinIO).
bun run dev:infra:start

# 2. Create the schema: boot the backend once so migrationsRun builds it on the empty
#    DB, wait for the migration log, then stop it.
bun run --filter '@cleancentive/backend' dev   # Ctrl-C after migrations finish

# 3. Restore the whole chain (latest full + increments). Localhost → no prod gate.
bun run data:restore
```

To start from a truly empty DB, drop and recreate it (`DROP DATABASE` /
`CREATE DATABASE`) rather than `docker compose down -v` — the latter wipes **all** dev
volumes (including data with no backup).

Note: replace mode's `TRUNCATE … CASCADE` also clears out-of-scope tables that FK into
in-scope ones (e.g. session/OIDC rows referencing `users`). On a fresh DB this is a
no-op; on an existing dev DB it discards those ephemeral rows, which are re-derived.

### (c) Production restore drill

```bash
# DB_HOST points at production; --target-is-production is mandatory.
bun run data:restore -- --target-is-production            # chain restore, or:
bun run data:import -- --input data/<bundle> --mode replace --target-is-production
```

When `DB_HOST` is not localhost, `--target-is-production` is required. A production
replace (single bundle or the full at the head of a chain) prints a per-table
current-vs-bundle row-count diff and requires typing `YES`.

> **Production guardrail.** Production data state must be reproducible from a known
> bundle and **never** hand-edited in the database. Restores go through `db:import`
> with the `--target-is-production` gate, the same way server config goes through
> `infrastructure/scripts/idempotato` (see `AGENTS.md`: "Never make ad-hoc changes on
> the production server… All server state must be reproducible."). Treat a prod
> restore as a deliberate, reviewed drill — never an ad-hoc fix.

## Synthetic data generation

The generator (`backend/scripts/generate-synthetic.ts`) builds a deterministic
~18-month world — users joining on an adoption ramp, teams, recurring cleanups, and
spots (picks) with mixed detection outcomes — and emits a bundle (always `type: full`).
It **only writes files**; load it with `data:import --mode merge`. Spot images are real
litter photos from a local [TACO](http://tacodataset.org) dataset checkout.

```bash
# 1. Export the seeded label ids so detected_items reference real labels.
bun run data:export -- --scope labels --output data/labels-snapshot

# 2. Generate a base world (Basel + Pfadfinder) → data/synthetic-base-basel/ by default.
bun run data:generate -- \
  --spec backend/scripts/synthetic/specs/base-basel.json \
  --labels-from data/labels-snapshot

# 3. Merge it into the dev DB (additive, idempotent — safe to re-run).
bun run data:import -- --input data/synthetic-base-basel --mode merge
```

Key flags (`bun run data:generate -- --help` for the full list):

- `--output <dir>` (default: `data/synthetic-<layerId>`), `--spec <file>` (default: built-in Basel base world).
- `--seed`, `--layer-id`, `--users`, `--spots`, `--window <start:end>` — override spec fields.
- `--taco-path <dir>` — TACO checkout root (default `/Users/matthias/git/TACO`). Only images present on disk are used.
- `--downscale <px>` — downscale originals (default: copy verbatim).
- `--labels-from <dir>` — resolve label ids from a labels export (**recommended** for a seeded DB).
- `--labels emit` — emit labels with deterministic ids instead (self-contained; only for an **empty** DB — otherwise it duplicates the bootstrap-seeded labels).
- `--no-images`, `--dry-run`.

### Determinism & idempotency

Every id is a `uuidv5` derived from the layer's `layerId` + a stable logical key, and
all randomness comes from a seeded PRNG. Re-generating from the same spec produces a
byte-identical bundle, and re-importing via `--mode merge` upserts in place (zero
duplicate logical rows).

### Layered worlds (scenario packs)

Compose larger worlds by generating multiple **self-contained** layers with distinct
`layerId`s and importing them in sequence:

```bash
bun run data:generate -- --spec backend/scripts/synthetic/specs/base-basel.json  --labels-from data/labels-snapshot
bun run data:generate -- --spec backend/scripts/synthetic/specs/pack-zuerich.json --labels-from data/labels-snapshot

bun run data:import -- --input data/synthetic-base-basel   --mode merge
bun run data:import -- --input data/synthetic-pack-zuerich --mode merge
```

Each layer namespaces all of its ids and unique fields (emails, team/cleanup names) by
`layerId`, so packs never collide with the base or with real app-generated rows. Design
background is in
[docs/dataset-layered-builder-research.md](docs/dataset-layered-builder-research.md).

## Troubleshooting

- **`Unsupported manifest version`** — bundles must be `version: 1` or `2`.
- **Spec/file not found with a relative path** — paths are repo-root-relative; e.g. use `--spec backend/scripts/synthetic/specs/base-basel.json` (not `scripts/...`).
- **`No compatible base bundle … cannot do --incremental`** — run a full export first, or keep `--scope`/source consistent across the chain.
- **`Cannot set session_replication_role`** — the fast FK-deferral path needs an elevated DB role; the import falls back to the two-pass approach automatically.
- **Deleted rows reappear after a chain restore** — expected; increments are additive. Take a fresh full (`data:backup`) to reconcile deletions.
- **Duplicate labels after a synthetic merge** — you used `--labels emit` against a DB that already seeded labels; regenerate with `--labels-from <labels-export>`.
- **No TACO images found** — point `--taco-path` at a TACO checkout containing `data/annotations.json` and the image batch folders.
