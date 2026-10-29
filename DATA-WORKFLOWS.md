# Data Workflows — Export, Import, Backup & Synthetic Generation

This document covers how CleanCentive moves application data around: backing up the
database + object storage, restoring it, running drills, and generating realistic
synthetic datasets.

All tools share one **bundle format**, so a synthetic dataset and a real export are
interchangeable: you can restore a backup, then layer synthetic scenario packs on top.

By default the export keeps **one folder per source** in the git-ignored **`data/`**
folder at the repo root (`data/local/`, `data/prod/`) and updates it in place: each
run fetches only rows that are new or changed, archives rows that vanished, and
downloads only images that are not on disk yet. The folder name never changes;
everything about the runs lives in files inside it.

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
| `bun run data:export -- [--source <name>]` | Bring `data/<source>/` up to date (only the delta is transferred) |
| `bun run data:backup -- [--source <name>]` | Same as `data:export` |
| `bun run data:export -- --full --output <dir>` | One-off snapshot of everything into exactly `<dir>` |
| `bun run data:import -- --input <dir> --mode <replace\|merge>` | Import a bundle |
| `bun run data:restore -- --source <name>` | Replace the DB with `data/<source>/` (= `data:import --input data/<source> --mode replace`) |
| `bun run data:generate -- [--spec <file>] [...]` | Generate a synthetic bundle (see below) |
| `bun run data:clean-e2e [-- --apply]` | Remove what the Playwright suite left in the dev database (see below) |

The underlying scripts can also be run directly from the `backend/` workspace
(`cd backend && bun run db:export -- ...`, `db:import`, `db:generate`) — path
resolution is identical (repo-root-relative).

## Clearing out e2e data

Every `bun run test:e2e` signs up throwaway accounts and creates teams and cleanups
under them, so after a few runs the local app is mostly test rows and there is
nowhere clean to look at a feature by hand.

```bash
bun run data:clean-e2e             # dry run: says what would go
bun run data:clean-e2e -- --apply  # delete it
```

It removes cleanups and teams named `E2E …` and accounts on `@example.com` — the
shapes `frontend/e2e/helpers` produces. An account that owns spots is kept even
if it looks like a test one, and the script refuses to run against anything but a
local database.

Take a `bun run data:backup` first if the database holds anything you care about.

## Bundle format (the contract)

A bundle is a directory. The default export keeps one per source, `data/<source>/`:

```
data/prod/
  manifest.json            # what the folder holds and when it was last synced (below)
  <table>.ndjson           # current rows, one JSON object per line, sorted by primary key
  images/<s3-key>          # mirrors S3 keys, e.g. images/spots/<id>/original-<uploadId>.jpg
  sync-log.ndjson          # one line per run: rows added/changed/archived per table, images
  .sync/hashes.json        # primary key → row hash from the last run (drives the next delta)
  deleted/<table>.ndjson   # rows that vanished from the source: {deleted_detected_at, row}
  images/.deleted/<s3-key> # images no longer referenced by any live spot
```

`sync-log.ndjson`, `.sync/`, `deleted/` and `images/.deleted/` are bookkeeping: the
importer never reads them, so restoring the folder restores the source's live state.
A one-off `--full --output <dir>` snapshot has only the manifest, tables and images.

`manifest.json` (version 3):

```json
{
  "version": 3,
  "type": "mirror",                     // or "full" for a one-off snapshot
  "bundle_id": "prod",
  "source_label": "prod",               // --source, else BACKUP_SOURCE, else from DB_HOST
  "high_watermark": "2026-10-29 07:31:02.321629",  // source DB clock of the snapshot read
  "exported_at": "2026-10-29T07:31:22.000Z",
  "source_database": "cleancentive",
  "source_host": "127.0.0.1",
  "scope": ["labels", "users", "teams", "cleanups", "spots", "feedback"],
  "tables": { "spots": { "row_count": 2573 }, "spot_edits": { "row_count": 5 } },
  "images": { "downloaded": 0, "failed": 0, "skipped": false, "on_disk": 5146, "pending": 0, "cap_exceeded": false }
}
```

`db-import` accepts versions 1 and 2 (older full and incremental bundles) and 3.

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

## Export

```bash
bun run data:export                          # bring data/local/ up to date
bun run data:export -- --source prod         # bring data/prod/ up to date (prod env, see runbook)
bun run data:export -- --full --output data/before-migration   # one-off snapshot
```

Flags:

- `--source <name>` — the source's name and folder. Default: `BACKUP_SOURCE`, else
  derived from `DB_HOST` (`localhost`/`127.0.0.1` → `local`). **A production export
  over an SSH tunnel connects to `127.0.0.1`, so always pass `--source prod`.**
- `--output-root <dir>` — folder holding the per-source folders (default: `data/`).
- `--output <dir>` — use exactly this folder instead of `<root>/<source>`.
- `--full` — one-off snapshot into `--output` (required): every row, every image, no
  sync state. Rerunning into the same folder resumes the image download.
- `--scope <groups>` — subset of `users, teams, cleanups, spots, labels, feedback`, or
  `all` (default). A folder keeps the scope of its first run; another scope needs
  another `--output`.
- `--no-images` — skip images.

**How a run works.** Every table is read from one `REPEATABLE READ` snapshot. For each
table the source sends only a primary key and an `md5` of the row (about 50 bytes per
row); rows whose hash moved since the last run, or that are missing locally, are then
fetched in full. That catches every write, whether or not it bumps `updated_at`. Rows
the source no longer has are appended to `deleted/<table>.ndjson` before they leave the
table file, so an accidental delete on the source stays recoverable. Images: every key
referenced by a live spot that is not on disk is downloaded; images nothing references
any more move to `images/.deleted/`. A run without sync state (first run, or an older
bundle renamed to `data/<source>/`) fetches every row once and still downloads only
the missing images.

Files are written through a temp file and renamed: the archive first, then the table
files, then the hashes, the manifest last. A run that dies leaves a state the next run
completes.

**Object-store daily cap.** Backblaze B2 refuses downloads once the account's daily
download or Class B cap is used up, and the same cap serves production thumbnails. The
export stops the image phase at the first such answer instead of trying every remaining
object, records `pending` and `cap_exceeded` in the manifest, and exits with code `2`.
The next run downloads what is still missing. Only a first run into an empty folder
moves gigabytes; routine runs move the few images of new picks.

Connection env vars (dev defaults): `DB_HOST=localhost`, `DB_PORT=5432`,
`DB_USERNAME=cleancentive`, `DB_PASSWORD=…`, `DB_DATABASE=cleancentive`;
`S3_ENDPOINT=http://localhost:9002`, `S3_REGION=us-east-1`,
`S3_BUCKET=cleancentive-images`, `S3_ACCESS_KEY=minioadmin`, `S3_SECRET_KEY=minioadmin`.

## Import

```bash
bun run data:import -- --input data/<bundle> --mode <replace|merge>
bun run data:restore -- --source prod      # = --input data/prod --mode replace
```

- `replace` — `TRUNCATE … CASCADE` the in-scope tables (reverse order), then insert.
  The bundle becomes authoritative for its scope.
- `merge` — upsert `ON CONFLICT (id) DO UPDATE`. Additive and idempotent (used for
  synthetic packs).
- `--source <name>` — shorthand for `--input data/<name>`.
- `--scope <groups>`, `--no-images`, `--dry-run`, and `--target-is-production` (below).

Images are uploaded from `images/`, skipping `images/.deleted/`. Rows in `deleted/`
are never imported; to bring one back, copy its `row` into the table file first.

**FK handling.** Replace sets `session_replication_role = 'replica'` to defer FK
checks during the transaction (needs an elevated DB role); if unavailable, a two-pass
fallback NULLs the circular `users` columns (`active_team_id`,
`active_cleanup_date_id`, `avatar_email_id`) then restores them. Merge mode alone does
not defer FKs, so a merge-only bundle must not contain forward references unsatisfiable
in insert order (the synthetic generator leaves those `users` columns NULL).

## Backup / restore runbook

### (a) Back up production

Read-only against production; run it as often as you like, a run without changes
transfers a few hundred KB and no images.

```bash
# 1. Tunnel to the prod database (5432 locally is the dev DB, so use 5433).
ssh -f -N -i ~/.ssh/cleancentive_deploy -L 127.0.0.1:5433:127.0.0.1:5432 deploy@46.225.228.123

# 2. Credentials from the private repo, then sync data/prod/.
set -a; eval "$(grep -E '^(DB_USERNAME|DB_PASSWORD|DB_DATABASE|S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY|S3_BUCKET|S3_REGION)=' ../cleancentive-private/.env)"; set +a
DB_HOST=127.0.0.1 DB_PORT=5433 bun run data:backup -- --source prod

# 3. Close the tunnel.
pkill -f "5433:127.0.0.1:5432"
```

Check the last line of `data/prod/sync-log.ndjson`. Exit code `2` means the B2 daily
cap stopped the image phase; rerun after midnight UTC. Remember the scope boundary
above.

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

# 3. Restore a backup folder. Localhost → no prod gate.
bun run data:restore -- --source prod
```

A scratch database works too: `CREATE DATABASE`, then `CREATE EXTENSION postgis` and
`CREATE EXTENSION "uuid-ossp"` in it before the migrations run.

To start from a truly empty DB, drop and recreate it (`DROP DATABASE` /
`CREATE DATABASE`) rather than `docker compose down -v` — the latter wipes **all** dev
volumes (including data with no backup).

Note: replace mode's `TRUNCATE … CASCADE` also clears out-of-scope tables that FK into
in-scope ones (e.g. session/OIDC rows referencing `users`). On a fresh DB this is a
no-op; on an existing dev DB it discards those ephemeral rows, which are re-derived.

### (c) Production restore drill

```bash
# DB_HOST points at production; --target-is-production is mandatory.
bun run data:restore -- --source prod --target-is-production
```

When `DB_HOST` is not localhost, `--target-is-production` is required. A production
replace prints a per-table
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

- **`Unsupported manifest version`** — bundles must be `version: 1`, `2` or `3`.
- **Spec/file not found with a relative path** — paths are repo-root-relative; e.g. use `--spec backend/scripts/synthetic/specs/base-basel.json` (not `scripts/...`).
- **`… holds scope [...]; this run asks for [...]`** — a backup folder keeps the scope of its first run; pass another `--output` for a different scope.
- **A prod backup landed in `data/local/`** — the tunnel makes the host `127.0.0.1`; pass `--source prod`.
- **Export exits with code 2** — the object store's daily cap stopped the image phase; rows are up to date, rerun after the cap resets for the missing images.
- **`Cannot set session_replication_role`** — the fast FK-deferral path needs an elevated DB role; the import falls back to the two-pass approach automatically.
- **Duplicate labels after a synthetic merge** — you used `--labels emit` against a DB that already seeded labels; regenerate with `--labels-from <labels-export>`.
- **No TACO images found** — point `--taco-path` at a TACO checkout containing `data/annotations.json` and the image batch folders.
