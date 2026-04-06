# Public API Surface — Design Document

> **Status:** Design document for reference and stakeholder discussion. No implementation yet.
> **Date:** 2026-03-14
> **Decisions made:** Real-time data (no delay), ODbL 1.0 license, self-service trial keys + admin-approved production keys.

## Context

Cleancentive currently has no public-facing API — all endpoints serve the UI. The platform holds valuable environmental data (geolocated litter photos, ML detection results, cleanup events) that researchers, municipalities, partner platforms (OpenLitterMap, Litterati), and civic developers want to access. A public API would position Cleancentive as the canonical open litter data source and enable the federation/interop roadmap outlined in [federation-analysis.md](federation-analysis.md).

---

## What to Expose

### Tier 1: Read-Only Data (Phase 1 MVP)

| Endpoint | Description | Auth |
|----------|-------------|------|
| `GET /api/v1/public/spots` | Paginated, filterable spots with detected items. Supports `bbox`, `after`, `before`, `cursor`, `limit`, `format=json\|geojson` | API key (`read:spots`) |
| `GET /api/v1/public/spots/:id` | Single spot with detected items | API key (`read:spots`) |
| `GET /api/v1/public/spots/:id/thumbnail` | Thumbnail image (low-res JPEG) | API key (`read:spots`) |
| `GET /api/v1/public/cleanups` | Upcoming/past cleanups with dates, locations, participant counts (no identities) | API key (`read:cleanups`) |
| `GET /api/v1/public/cleanups/:id` | Single cleanup detail | API key (`read:cleanups`) |
| `GET /api/v1/public/stats/summary` | Platform totals: spots, items, cleanups, top categories | API key (`read:stats`) |
| `GET /api/v1/public/stats/items` | Aggregated items grouped by category/material/brand, filterable by bbox and time range | API key (`read:stats`) |
| `GET /api/v1/public/stats/hotspots` | Grid-cell aggregation of spot density, returned as GeoJSON FeatureCollection | API key (`read:stats`) |

### Tier 2: Bulk Export (Phase 1 MVP)

| Endpoint | Description | Auth |
|----------|-------------|------|
| `GET /api/v1/public/export/spots` | Streamed CSV or GeoJSON of spots + items. Max 10K per request | API key (`export`) |
| `GET /api/v1/public/export/items` | Flat CSV: spot_id, lat, lon, captured_at, category, material, brand, weight, confidence | API key (`export`) |

### Tier 3: Dataset Downloads (Phase 2)

| Endpoint | Description | Auth |
|----------|-------------|------|
| `GET /api/v1/public/datasets` | List available dataset snapshots (nightly generated) | API key (`dataset`) |
| `GET /api/v1/public/datasets/:id/download` | Redirect to signed S3 URL for full dataset | API key (`dataset`) + data use agreement |

Dataset snapshots include full-resolution images. Requires signed data use agreement.

### Tier 4: Write Access (Phase 2)

| Endpoint | Description | Auth |
|----------|-------------|------|
| `POST /api/v1/public/spots` | Third-party spot submission with `source_attribution` field | API key (`write:spots`) |

### Tier 5: Webhooks (Phase 3)

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/public/webhooks` | Register webhook for events: `spot.completed`, `spot.deleted`, `cleanup.created` |
| `GET /api/v1/public/webhooks` | List registered webhooks |
| `DELETE /api/v1/public/webhooks/:id` | Remove webhook |

---

## Anonymization Rules

All public endpoints strip:
- `user_id`, `created_by`, `updated_by` — never exposed
- `upload_id`, `image_key`, `thumbnail_key` — internal identifiers
- `processing_error`, `detection_raw` — internal debugging data

Coordinates truncated to **4 decimal places** (~11m precision) — sufficient for environmental analysis, prevents pinpointing exact user locations.

Public spot DTO:
```typescript
interface PublicSpotDto {
  id: string;
  latitude: number;       // truncated to 4 decimals
  longitude: number;      // truncated to 4 decimals
  captured_at: string;
  item_count: number;
  items: { id, category, material, brand, weight_grams, confidence }[];
  thumbnail_url: string | null;
  cleanup_id: string | null;
  team_id: string | null;
}
```

---

## Authentication

### Device Code Flow (First-Party CLI)

For first-party CLI tools (e.g., `triagato`), a device code flow avoids manual token copy-paste:

1. CLI calls `POST /api/v1/auth/device-code` → `{ id, deviceCode, expiresIn }`
2. User opens `https://app.cleancentive.org/auth/device?code={deviceCode}` in browser
3. User approves (requires active admin session) → `POST /api/v1/auth/device-code/approve`
4. CLI polls `GET /api/v1/auth/device-code/{id}` → `{ status: 'completed', sessionToken }`

Device codes expire in 5 minutes. The resulting session token has standard 365-day expiry. This flow is implemented and used by the `/triagato` feedback triage command.

### API Key System (Third Parties)

New `api_keys` table:

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | PK |
| name | varchar | Human label ("Dr. Smith — TU Berlin") |
| key_hash | varchar | bcrypt hash |
| key_prefix | varchar(8) | First 8 chars for identification in logs |
| scopes | varchar[] | `['read:spots', 'read:cleanups', 'read:stats', 'export', 'dataset', 'write:spots']` |
| tier | varchar | `trial`, `free`, `research`, `partner` |
| rate_limit_per_minute | int | Per-tier default, overridable |
| rate_limit_per_day | int | Per-tier default, overridable |
| contact_email | varchar | Required |
| organization | varchar | Optional |
| created_by_user_id | uuid | Admin who issued it (null for self-service) |
| last_used_at | timestamp | Debounced update |
| expires_at | timestamp | Nullable |
| revoked_at | timestamp | Nullable |

Key format: `cc_live_<random32>` — prefix makes keys identifiable in leak scanners.

### Two-Track Key Provisioning

**Self-service trial keys** (immediate, no admin involvement):
- Developer registers with email, gets a trial key instantly
- Trial keys: `tier=trial`, expires in **72 hours**, low rate limits (30/min, 1,000/day), no export scope
- Purpose: let developers explore the API, build a proof of concept, decide if they want full access
- No admin approval needed — keeps friction near zero
- Expired trial keys can be renewed once (another 72h) via the same endpoint

**Admin-approved production keys** (long-lived):
- Developer applies via a form (email, org, intended use, requested scopes)
- Admin reviews and issues key with appropriate tier, scopes, and expiry
- Production keys: `tier=free|research|partner`, long-lived (1 year default, renewable)

Admin endpoints (behind existing JwtAuthGuard + AdminGuard):
- `POST /api/v1/admin/api-keys` — create production key, returns plaintext once
- `GET /api/v1/admin/api-keys` — list keys (no plaintext)
- `GET /api/v1/admin/api-keys/applications` — list pending applications
- `POST /api/v1/admin/api-keys/applications/:id/approve` — approve with tier/scopes
- `POST /api/v1/admin/api-keys/applications/:id/reject` — reject with reason
- `DELETE /api/v1/admin/api-keys/:id` — revoke

Self-service endpoints (unauthenticated):
- `POST /api/v1/public/api-keys/trial` — register with email, get trial key
- `POST /api/v1/public/api-keys/apply` — apply for production key (email, org, use case)

### Rate Limiting Tiers

| Tier | Per-minute | Per-day | Export/day | Dataset/month | Expiry |
|------|-----------|---------|------------|---------------|--------|
| Trial | 30 | 1,000 | 0 | 0 | 72 hours |
| Free | 60 | 10,000 | 5 | 0 | 1 year |
| Research | 300 | 100,000 | 50 | 10 | 1 year |
| Partner | 1,000 | unlimited | unlimited | unlimited | 1 year |

Implementation: `@nestjs/throttler` with Redis backend (already available).

---

## Image Access: What and How

| Access level | Content | Who gets it | Privacy risk |
|-------------|---------|-------------|--------------|
| **Thumbnail via API** | Low-res JPEG (~30-50KB, 320px max) | Any API key with `read:spots` | Low — typically shows ground/litter |
| **Full images via dataset** | Original JPEG (up to 15MB) | `dataset` scope + signed data use agreement | Higher — may contain faces, plates |

### Safeguards
- EXIF metadata stripped before serving (GPS, device info)
- Full images only via dataset downloads, not per-spot API
- CDN caching for thumbnails to manage bandwidth

---

## Data Freshness

**Decision: Real-time.** All completed spots are available immediately via the public API. No artificial delay. Maximizes utility for researchers and partners.

---

## Licensing & Terms of Use

### License
- **Database (spots + detections):** Open Database License (ODbL) 1.0 — same as OpenStreetMap. Requires attribution, share-alike for derivative databases, allows commercial use.
- **Images:** CC BY-SA 4.0 — requires attribution, share-alike.

### Terms of Use — Key Provisions

1. **Prohibited uses:** surveillance, facial recognition training, person re-identification, harassment
2. **Attribution required:** "Data from Cleancentive (cleancentive.org)" in any derivative work
3. **Share-alike:** Derivative databases must use compatible license
4. **Rate limits / fair use:** Automated circumvention (key rotation, distributed scraping) prohibited
5. **Right to revoke:** Cleancentive may revoke keys for ToS violations without notice
6. **No guarantee:** API provided "as is", endpoints/limits may change with 30 days notice
7. **Data accuracy disclaimer:** ML detections have confidence scores, not ground truth
8. **GDPR:** EU consumers become data processors; must honor deletion notifications
9. **User consent chain:** Platform privacy policy covers anonymized data sharing

### Competitive Risk Mitigation
- Attribution + share-alike via ODbL prevents unadvertised cloning
- The moat is community + ML pipeline + UX, not the data itself
- Open data strengthens Cleancentive's position as the canonical litter data source

---

## Standards & Interoperability

- **GeoJSON (RFC 7946):** All spatial endpoints support `format=geojson` with `[lon, lat]` coordinate order
- **OSPAR/GESAMP mapping:** Future category mapping table to align with international litter monitoring standards. Optional `?classification=ospar` query parameter
- **OpenAPI spec:** Full Swagger annotations, downloadable at `/api/v1/public/openapi.json`
- **Platform compatibility:** Export transforms for OpenLitterMap, Litterati field naming (low priority, Phase 2+)

---

## Module Structure

```
backend/src/public/
  public.module.ts
  public-spot.controller.ts
  public-cleanup.controller.ts
  public-stats.controller.ts
  public-export.controller.ts
  dto/
    public-spot.dto.ts
    public-cleanup.dto.ts

backend/src/api-key/
  api-key.module.ts
  api-key.entity.ts
  api-key.service.ts
  api-key.guard.ts
  api-key-scope.decorator.ts
  api-key-admin.controller.ts
```

Key existing files to modify:
- `backend/src/app.module.ts` — register PublicModule and ApiKeyModule
- `backend/src/main.ts` — CORS config for public endpoints (`*`), throttler setup

---

## Verification

1. Create API key via admin endpoint, verify key format and storage
2. Call each public endpoint with valid/invalid/missing API key — verify auth and scope enforcement
3. Verify anonymization: no user IDs, truncated coordinates, no internal fields in responses
4. Test rate limiting: exceed free tier limits, verify 429 responses with correct headers
5. Test GeoJSON format output against RFC 7946
6. Test CSV/GeoJSON export streaming with large result sets
7. Verify CORS allows cross-origin requests to public endpoints
