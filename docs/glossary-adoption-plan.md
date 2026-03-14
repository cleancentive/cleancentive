# Glossary Adoption Plan

Concrete plan for applying the [Domain Glossary](domain-glossary.md) to the current codebase. Breaking changes are expected — no version has been released.

---

## Phase 1: Directory & Module Restructure

Swap the two main domain directories so that names match the glossary:

| Current | New | Domain |
|---|---|---|
| `backend/src/cleanup/` | `backend/src/spot/` | Litter spots & picks |
| `backend/src/event/` | `backend/src/cleanup/` | Organized cleanup events |

**Execution order:** Rename `cleanup/` → `spot/` first, then `event/` → `cleanup/`. This avoids a collision.

---

## Phase 2: Backend — Spot Module (was `cleanup/`)

### File Renames

| Current | New |
|---|---|
| `spot/cleanup-report.entity.ts` | `spot/spot.entity.ts` |
| `spot/cleanup.service.ts` | `spot/spot.service.ts` |
| `spot/cleanup.controller.ts` | `spot/spot.controller.ts` |
| `spot/cleanup.module.ts` | `spot/spot.module.ts` |
| `spot/litter-item.entity.ts` | `spot/detected-item.entity.ts` |

### Class & Symbol Renames

| Current | New | File(s) |
|---|---|---|
| `CleanupReport` | `Spot` | `spot.entity.ts`, all imports |
| `@Entity('cleanup_reports')` | `@Entity('spots')` | `spot.entity.ts` |
| `CleanupService` | `SpotService` | `spot.service.ts`, all imports |
| `CleanupController` | `SpotController` | `spot.controller.ts` |
| `@Controller('cleanup')` | `@Controller('spots')` | `spot.controller.ts` |
| `CleanupModule` | `SpotModule` | `spot.module.ts`, `app.module.ts` |
| `LitterItem` | `DetectedItem` | `detected-item.entity.ts`, all imports |
| `@Entity('litter_items')` | `@Entity('detected_items')` | `detected-item.entity.ts` |
| `reportRepository` | `spotRepository` | `spot.service.ts` |
| All `analysis_*` fields | `detection_*` | See Phase 4 |

### API Route Changes

| Current | New | Method |
|---|---|---|
| `POST /cleanup/uploads` | `POST /spots` | Upload a spot |
| `GET /cleanup/uploads/:id` | `GET /spots/:id` | Get spot status |
| `GET /cleanup/reports` | `GET /spots` | List spots |
| `POST /cleanup/reports/:id/retry` | `POST /spots/:id/retry` | Retry detection |
| `GET /cleanup/reports/:id/thumbnail` | `GET /spots/:id/thumbnail` | Get thumbnail |

### Files Requiring Import Updates

- `backend/src/app.module.ts` — `SpotModule`, `Spot`, `DetectedItem` imports
- `backend/src/admin/admin-ops.service.ts` — `Spot` import, repository injection
- `backend/src/spot/detected-item.entity.ts` — `@ManyToOne('Spot', ...)` relation string

---

## Phase 3: Backend — Cleanup Module (was `event/`)

### File Renames

| Current | New |
|---|---|
| `cleanup/event.entity.ts` | `cleanup/cleanup.entity.ts` |
| `cleanup/event-occurrence.entity.ts` | `cleanup/cleanup-date.entity.ts` |
| `cleanup/event-participant.entity.ts` | `cleanup/cleanup-participant.entity.ts` |
| `cleanup/event-message.entity.ts` | `cleanup/cleanup-message.entity.ts` |
| `cleanup/event.service.ts` | `cleanup/cleanup.service.ts` |
| `cleanup/event.controller.ts` | `cleanup/cleanup.controller.ts` |
| `cleanup/event.module.ts` | `cleanup/cleanup.module.ts` |

### Class & Symbol Renames

| Current | New |
|---|---|
| `Event` | `Cleanup` |
| `@Entity('events')` | `@Entity('cleanups')` |
| `EventOccurrence` | `CleanupDate` |
| `@Entity('event_occurrences')` | `@Entity('cleanup_dates')` |
| `EventParticipant` | `CleanupParticipant` |
| `@Entity('event_participants')` | `@Entity('cleanup_participants')` |
| `EventMessage` | `CleanupMessage` |
| `@Entity('event_messages')` | `@Entity('cleanup_messages')` |
| `EventService` | `CleanupService` |
| `EventController` | `CleanupController` |
| `@Controller('event')` | `@Controller('cleanups')` |
| `EventModule` | `CleanupModule` |

### API Route Changes

| Current | New | Method |
|---|---|---|
| `POST /event` | `POST /cleanups` | Create cleanup |
| `GET /event/search` | `GET /cleanups/search` | Search cleanups |
| `GET /event/similar` | `GET /cleanups/similar` | Find similar |
| `GET /event/:id` | `GET /cleanups/:id` | Get cleanup |
| `POST /event/:id/join` | `POST /cleanups/:id/join` | Join cleanup |
| `POST /event/:id/leave` | `POST /cleanups/:id/leave` | Leave cleanup |
| `POST /event/:id/archive` | `POST /cleanups/:id/archive` | Archive cleanup |

### Cross-Module References

- `backend/src/spot/spot.entity.ts` — update `EventOccurrence` → `CleanupDate` import and relation
- `backend/src/user/user.entity.ts` — update `active_event_occurrence_id` field name and any `Event` references
- `backend/src/app.module.ts` — `CleanupModule`, `Cleanup`, `CleanupDate`, `CleanupParticipant`, `CleanupMessage` imports

---

## Phase 4: analysis → detection (Global)

### Database Column Renames

| Table | Current Column | New Column |
|---|---|---|
| `spots` (was `cleanup_reports`) | `analysis_started_at` | `detection_started_at` |
| `spots` | `analysis_completed_at` | `detection_completed_at` |
| `spots` | `analysis_raw` | `detection_raw` |

### Code References

| File | Current | New |
|---|---|---|
| `spot/spot.entity.ts` | `analysis_started_at`, `analysis_completed_at`, `analysis_raw` | `detection_started_at`, `detection_completed_at`, `detection_raw` |
| `spot/spot.service.ts` | `report.analysis_started_at = null` | `spot.detection_started_at = null` |
| `spot/spot.controller.ts` | `analysisCompletedAt: report.analysis_completed_at` | `detectionCompletedAt: spot.detection_completed_at` |
| `admin/admin-ops.service.ts` | `MIN(analysis_started_at)` in SQL | `MIN(detection_started_at)` |
| Existing migration SQL | `"analysis_*"` column definitions | `"detection_*"` |

---

## Phase 5: Worker

| File | Current | New |
|---|---|---|
| `worker/src/index.ts` | `interface ImageAnalysisJobData` | `interface LitterDetectionJobData` |
| `worker/src/index.ts` | `interface AnalysisResult` | `interface DetectionResult` |
| `worker/src/index.ts` | `analysisModel`, `analysisBaseUrl`, `analysisApiKey` | `detectionModel`, `detectionBaseUrl`, `detectionApiKey` |
| `worker/src/index.ts` | Queue name default `'image-analysis'` | `'litter-detection'` |
| `worker/src/index.ts` | System prompt: "You analyze cleanup photos" | Update to detection vocabulary |

### Environment Variables

| Current | New |
|---|---|
| `ANALYSIS_QUEUE_NAME` | `DETECTION_QUEUE_NAME` |
| `ANALYSIS_API_KEY` | `DETECTION_API_KEY` |
| `ANALYSIS_BASE_URL` | `DETECTION_BASE_URL` |
| `ANALYSIS_MODEL` | `DETECTION_MODEL` |

Update in: `backend/.env.example`, `worker/.env.example`, and any `.env` files.

---

## Phase 6: Frontend

### UI String Changes

| File | Current | New |
|---|---|---|
| `CapturePanel.tsx` | `Capture Cleanup` | `Log a Pick` |
| `CapturePanel.tsx` | `Capture and Queue` | `Log Pick` |
| `CapturePanel.tsx` | `Outbox` (status label) | `Pending` |
| `HistoryPanel.tsx` | `Upload History` | `My Picks` |
| `HistoryPanel.tsx` | `Retry analysis` | `Retry detection` |
| `HistoryPanel.tsx` | `Upload pending` | `Waiting to sync` |
| `HistoryPanel.tsx` | `Uploading…` | `Syncing...` |
| `HistoryPanel.tsx` | `Upload failed` | `Sync failed` |
| `HistoryPanel.tsx` | `No uploads yet. Capture or import a photo to start your history.` | `No picks yet. Take or import a photo to log your first pick.` |
| `AppLayout.tsx` | Intro text referencing "cleanup" / "reporting" | Update to pick/spot vocabulary |

### Processing Status Labels (HistoryPanel)

| Internal | Current Label | New Label |
|---|---|---|
| `queued` | Queued | Waiting for detection |
| `processing` | Processing | Detecting litter... |
| `completed` | Completed | Complete |
| `failed` | Processing failed | Detection failed |

### IndexedDB & Offline Storage

| File | Current | New |
|---|---|---|
| `lib/uploadOutbox.ts` | `STORE_NAME = 'upload-outbox'` | `STORE_NAME = 'pending-picks'` |
| `lib/uploadOutbox.ts` | File rename → `lib/pendingPicks.ts` | Update all imports |

### API Client Paths

Update all `fetch`/API calls to use new route paths (`/spots` instead of `/cleanup/uploads`, `/cleanup/reports`).

---

## Phase 7: Admin

| File | Current | New |
|---|---|---|
| `admin/admin-ops.service.ts` | `CleanupReport` references | `Spot` |
| `admin/admin-ops.service.ts` | `analysis_started_at` in SQL | `detection_started_at` |
| `admin/admin-ops.service.ts` | Queue name `'image-analysis'` | `'litter-detection'` |
| `AdminPanel.tsx` (frontend) | "Reports" card heading | "Spots" or "Picks" |
| `AdminPanel.tsx` | Report status counts (Queued/Processing/Completed/Failed) | Use detection vocabulary |

---

## Phase 8: Database Migration

Create `backend/src/migrations/<timestamp>-RenameToGlossaryTerms.ts`:

```sql
-- Table renames
ALTER TABLE "cleanup_reports" RENAME TO "spots";
ALTER TABLE "litter_items" RENAME TO "detected_items";
ALTER TABLE "events" RENAME TO "cleanups";
ALTER TABLE "event_occurrences" RENAME TO "cleanup_dates";
ALTER TABLE "event_participants" RENAME TO "cleanup_participants";
ALTER TABLE "event_messages" RENAME TO "cleanup_messages";

-- Column renames
ALTER TABLE "spots" RENAME COLUMN "analysis_started_at" TO "detection_started_at";
ALTER TABLE "spots" RENAME COLUMN "analysis_completed_at" TO "detection_completed_at";
ALTER TABLE "spots" RENAME COLUMN "analysis_raw" TO "detection_raw";

-- Index renames (update all IDX_cleanup_reports_* → IDX_spots_*)
-- Foreign key constraint renames
-- Update sequences if any
```

**Important:** Also update the existing migration files to use new names so that a fresh `schema:sync` or migration run creates tables with correct names from the start.

---

## Phase 9: Tests

- `backend/test/auth.service.spec.ts` — update any references to `CleanupReport`, `Event`, etc.
- Run full test suite: `bun test` in each workspace
- Verify all API endpoints at new paths
- Verify worker picks up jobs from `litter-detection` queue
- Verify frontend sync works with new API paths

---

## Phase 10: Documentation & Config

- Update `AGENTS.md` if it references old entity/module names
- Update `CONTRIBUTING.md` if applicable
- Update `docs/architecture/` diagrams (C4, data models) to reflect new names
- Update `docker-compose.yml` or deployment configs if they reference old queue/env names

---

## Execution Order

1. Phase 8 first (migration) — or update existing migrations in place since pre-release
2. Phase 1 (directory restructure)
3. Phases 2-3 (backend modules)
4. Phase 4 (analysis → detection)
5. Phase 5 (worker)
6. Phase 6 (frontend)
7. Phase 7 (admin)
8. Phase 9 (tests)
9. Phase 10 (docs & config)

Each phase should be a separate commit for clean git history.
