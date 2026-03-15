# Layered Dataset Builder - Current Research State

> Date: 2026-03-15
> Scope: Research summary for realistic long-lived application data generation ("18 months of use"), not unit test fixtures.

## Goal

Create a reproducible, performant dataset workflow that makes Cleancentive feel historically used, supports incremental expansion (city/group by city/group), and can optionally build on top of production exports.

## What We Confirmed In The Current Codebase

### Core persisted model to emulate

- `Spot` is the atomic historical record, with geolocation, capture time, image keys, and detection lifecycle state in `backend/src/spot/spot.entity.ts`.
- `DetectedItem` is a child row per detected litter item (`category`, `material`, `brand`, `weight_grams`, `confidence`).
- Community context exists and should be part of realistic history:
  - `Team`, `TeamMembership`, `TeamMessage`
  - `Cleanup`, `CleanupDate`, `CleanupParticipant`, `CleanupMessage`
  - User active context (`active_team_id`, `active_cleanup_date_id`) influences spot linkage behavior.

### Canonical domain language and behavior

- Glossary establishes key vocabulary and lifecycle expectations in `docs/domain-glossary.md`:
  - `Spot` (data model) and `Pick` (user-facing default where `picked_up=true`)
  - `Detection` with statuses `queued`, `processing`, `completed`, `failed`
  - `Team`, `Cleanup`, `Participant`
- For realism, generated data should include:
  - mixed pick/non-pick behavior,
  - mixed detection outcomes,
  - meaningful time progression,
  - community participation over time.

### Existing import/export and persistence reality

- Existing importer: `backend/scripts/import-mongo-export.ts` (`bun run import:mongo-export`), designed for legacy Mongo export migration.
- Current importer behavior:
  - imports users/spots/items,
  - uploads images and thumbnails to S3-compatible storage,
  - does not cover full modern community model end-to-end.
- Development persistence currently relies on Docker volumes in `infrastructure/docker-compose.dev.yml` (`postgres_data`, `redis_data`, `minio_data`).
- No complete, current-state backup/restore workflow exists yet for Postgres + object storage + operational restore runbook in repository docs/scripts.

## Layered Dataset Builder Concept (Research Direction)

### Why layering over a monolithic seed

Layering supports incremental growth without regenerating everything:

- start with a base world (`Basel` + `Pfadfinder`),
- add scenario packs later (`Zuerich` + `CSR Zuerich Versicherungen`),
- combine synthetic layers with imported real data snapshots.

### Proposed layers

1. Base synthetic world
   - deterministic long-lived timeline and actors
2. Incremental scenario packs
   - additive city/group/team/cleanup history packs
3. Snapshot/base import layer
   - ingest previously exported dataset (including production export)
4. Demo augmentation layer
   - add synthetic teams and history on top of imported base

## Performance And Reproducibility Requirements

- Deterministic generation from explicit seeds and manifests.
- Idempotent incremental apply (safe re-run, no duplicate logical records).
- Batch-oriented writes and predictable ordering by dependencies.
- Avoid unnecessary image transforms during synthetic generation where possible.
- Support configurable external image source path (for example `/Users/matthias/git/TACO/data`).

## Product Decision Captured In This Session

- Import/export is now prioritized before full synthetic world-building because it is needed for production backup/restore anyway.
- Production data import/export is allowed without anonymization for this workflow.

## Practical Sequence (Current Recommendation)

1. Build robust import/export and restore primitives first (Postgres + object storage scope clearly defined).
2. Build layered synthetic generation on top of those primitives.
3. Use exported snapshots as optional base layers; apply synthetic scenario packs afterward.

## Open Design Items To Resolve Next

- Export format and manifest shape (single archive vs folder-based bundles).
- How to represent layer identity and re-application safety.
- Image handling policy for export/import (copy vs reference vs dedupe).
- Restore semantics (full replace vs merge-on-top).
- Operational guardrails for production backup/restore drills and verification.
