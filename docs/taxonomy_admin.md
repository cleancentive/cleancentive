# Taxonomy Admin Page for Stewards

## Context

Labels (object, material, brand) form the taxonomy for classifying detected litter items. Labels are wiki-style — any authenticated user can create new labels from the spot editing UI. This creates a quality control need: stewards must review additions, fix translations, merge duplicates, and monitor taxonomy health. This page is the steward's workbench for maintaining the taxonomy.

**Target file:** `docs/taxonomy_admin.md` (copy this spec on implementation)

---

## 1. Database Changes

### Migration: pg_trgm + label_merges

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_label_translations_name_trgm
  ON label_translations USING gin (name gin_trgm_ops);

CREATE TABLE label_merges (
  id uuid PRIMARY KEY,
  canonical_label_id uuid NOT NULL REFERENCES labels(id),
  duplicate_label_id uuid NOT NULL,          -- no FK, label gets deleted
  duplicate_label_name varchar NOT NULL,      -- snapshot for audit
  items_reassigned integer NOT NULL DEFAULT 0,
  translations_transferred integer NOT NULL DEFAULT 0,
  merged_by uuid NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

New entity: `backend/src/label/label-merge.entity.ts`

### Environment

`SUPPORTED_LOCALES=en,de` — configurable via env var, parsed at startup via ConfigService. Defaults to `['en']`.

---

## 2. Backend API

All endpoints: `@Controller('admin/taxonomy')` with `JwtAuthGuard + AdminGuard`.

New files:
- `backend/src/admin/admin-taxonomy.controller.ts`
- `backend/src/admin/admin-taxonomy.service.ts`

### GET /admin/taxonomy/stats

No parameters. Returns:

```typescript
{
  byType: { type: string; total: number; orphans: number }[]
  translationCoverage: { locale: string; translated: number; total: number; percentage: number }[]
  creationSource: { seeded: number; userCreated: number }
  mostUsed: { id: string; name: string; type: string; itemCount: number }[]  // top 10
  leastUsed: { id: string; name: string; type: string; itemCount: number }[] // bottom 10
}
```

Key queries:
- Orphans: labels with no detected_items referencing them (check all 3 FK columns)
- Coverage: `COUNT(DISTINCT label_id)` per locale vs total labels
- Item count: UNION across `object_label_id`, `material_label_id`, `brand_label_id`

### GET /admin/taxonomy/labels

Paginated label list with coverage and usage data.

**Params:** `type`, `search`, `locale` (default en), `sort` (created_at|name|item_count), `order` (ASC|DESC), `filter` (missing_translations|orphans|recent), `page`, `limit`

**Returns:**

```typescript
{
  labels: {
    id: string
    type: string
    name: string                                          // in requested locale
    translations: { locale: string; name: string }[]
    missingLocales: string[]                              // locales without translation
    itemCount: number
    createdAt: string
    createdBy: string | null
    creatorNickname: string | null
  }[]
  total: number
  configuredLocales: string[]
}
```

### GET /admin/taxonomy/labels/:id/similar

Fuzzy duplicate detection via `pg_trgm similarity()`.

**Params:** `threshold` (default 0.3), `limit` (default 10)

**Returns:** `{ similar: { id: string; name: string; type: string; score: number; itemCount: number }[] }`

Only compares labels of the same type. Uses the GIN trigram index.

### GET /admin/taxonomy/labels/:id/samples

3-5 spot thumbnails that reference this label.

**Returns:** `{ samples: { spotId: string; thumbnailUrl: string }[] }`

`thumbnailUrl` = `/api/v1/spots/{spotId}/thumbnail` (existing endpoint, no new S3 access).

### PUT /admin/taxonomy/labels/:id/translations/:locale

Upsert a translation. **Body:** `{ name: string }`

Uses the `(label_id, locale)` unique constraint for upsert. Sets `created_by`/`updated_by` from JWT.

### POST /admin/taxonomy/merge

**Body:** `{ canonicalId: string, duplicateIds: string[] }`

Transaction:
1. Validate all labels exist and share same `type`
2. For each duplicate:
   - `UPDATE detected_items SET object_label_id = :canonical WHERE object_label_id = :duplicate` (same for material, brand)
   - Transfer missing translations to canonical
   - Insert `label_merges` audit row
   - `DELETE FROM labels WHERE id = :duplicate` (cascades translations)
3. Return summary with counts

### GET /admin/taxonomy/merge-log

Paginated audit log. **Params:** `page`, `limit`

---

## 3. Frontend Components

### Store: `frontend/src/stores/taxonomyStore.ts`

Zustand store following `adminStore.ts` pattern. State: stats, label list with pagination, filters (type, search, active filter, sort), selected label detail (similar + samples), merge state, translation editing state.

### Components

| Component | Purpose |
|-----------|---------|
| `TaxonomySection.tsx` | Top-level section, renders in AdminPanel |
| `TaxonomyStats.tsx` | Summary cards grid (totals, coverage bars, sources) |
| `TaxonomyLabelList.tsx` | Filterable/sortable label list with infinite scroll |
| `TaxonomyLabelRow.tsx` | Expandable row: translations, similar, samples, merge controls |
| `TranslationMatrix.tsx` | Coverage grid view (labels × locales, click-to-edit) |
| `MergeDialog.tsx` | Merge preview + confirmation modal |
| `MergeLog.tsx` | Audit table of past merges |

---

## 4. Page Layout

### Stats bar (always visible)

Grid of summary cards:

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ┌──────────────┐
│ Objects  │ │Materials │ │ Brands   │ │ Translation      │ │ Sources      │
│ 37 total │ │ 15 total │ │ 19 total │ │ en: ████████ 100%│ │ 142 seeded   │
│ 2 orphan │ │ 0 orphan │ │ 5 orphan │ │ de: ██████░░  87%│ │  38 user     │
└──────────┘ └──────────┘ └──────────┘ └──────────────────┘ └──────────────┘
```

### Controls bar

```
[All] [Object] [Material] [Brand]    [Search...________]    [Filter: ▾ All]  [Sort: ▾ Newest]
                                                             Missing translations
                                                             Orphans
                                                             Recent (7d)
```

**Call to action:** When filter = "Missing translations", the list shows only labels with incomplete coverage. Red locale dots are prominent. This is the steward's primary quality task.

### Label list

Each row:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Bottle          [object]  🟢en 🔴de    42 items   by culmat · 2 Mar 2026  │
│                                                                    [▼]     │
├─────────────────────────────────────────────────────────────────────────────┤
│ Expanded:                                                                  │
│                                                                            │
│ Translations:                                                              │
│   en: [Bottle          ] ✓    de: [_______________] [Save]                │
│                                                                            │
│ Similar labels:                                                            │
│   "Bottle Cap" (0.52)  12 items  [Merge ←]                               │
│   "Bottles"    (0.71)   3 items  [Merge ←]                               │
│                                                                            │
│ Sample images:                                                             │
│   [📷] [📷] [📷] [📷] [📷]   View all 42 spots →                        │
│                                                                            │
│ [◉ Set as canonical]  [☐ Mark as duplicate]                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Merge flow

1. Steward expands a label → sees similar labels with scores
2. Clicks "Merge ←" on a duplicate, or manually selects canonical + duplicate(s) via radio/checkbox
3. MergeDialog opens:
   - Shows canonical (name, translations, item count)
   - Shows each duplicate (name, translations, item count)
   - Summary: "X items will be reassigned, Y translations will be transferred"
4. Confirm → POST /merge → list refreshes → duplicates gone

### Translation matrix (alternate view)

Toggle between "List view" and "Matrix view":

```
Label            │  en       │  de       │  fr
─────────────────┼───────────┼───────────┼──────────
Bottle           │  Bottle   │  Flasche  │  [____]
Can              │  Can      │  Dose     │  [____]
Cigarette Butt   │  Cigare…  │  [____]   │  [____]
```

Click any empty cell to type a translation. Filled cells are editable on click.

---

## 5. Interaction Details

### Inline translation editing

1. Click red dot (or empty matrix cell) → input appears with locale badge
2. Type name → press Enter or click Save
3. PUT /admin/taxonomy/labels/:id/translations/:locale
4. Dot turns green, stats refresh

### Sample images

- Loaded lazily on row expand (GET /labels/:id/samples)
- 3-5 thumbnails as `<img src="/api/v1/spots/{spotId}/thumbnail">`
- Each links to spot detail
- "View all N spots →" links to history filtered by label

### Recently added (call to action)

- Default filter = "Recent" shows labels created in last 7 days
- Highlighted with a "New" badge
- Steward can quickly check name, add missing translations, find/merge duplicates

---

## 6. Files to Create/Modify

### New files
- `backend/src/migrations/<ts>-AddTaxonomyAdmin.ts`
- `backend/src/label/label-merge.entity.ts`
- `backend/src/admin/admin-taxonomy.controller.ts`
- `backend/src/admin/admin-taxonomy.service.ts`
- `frontend/src/stores/taxonomyStore.ts`
- `frontend/src/components/TaxonomySection.tsx`
- `frontend/src/components/TaxonomyStats.tsx`
- `frontend/src/components/TaxonomyLabelList.tsx`
- `frontend/src/components/TaxonomyLabelRow.tsx`
- `frontend/src/components/TranslationMatrix.tsx`
- `frontend/src/components/MergeDialog.tsx`
- `frontend/src/components/MergeLog.tsx`

### Modified files
- `backend/src/admin/admin.module.ts` — register new controller, service, entities
- `backend/src/label/label.module.ts` — export LabelTranslation repo
- `frontend/src/components/AdminPanel.tsx` — add TaxonomySection
- `frontend/src/App.css` — taxonomy styles

---

## 7. Implementation Order

1. **Backend foundation:** Migration, entity, stats + label list endpoints
2. **Backend merge + translations:** Similar search, upsert translation, merge endpoint, merge log
3. **Frontend store + stats:** taxonomyStore, TaxonomySection, TaxonomyStats
4. **Frontend label list + translations:** List, row, inline editing, TranslationMatrix
5. **Frontend merge:** MergeDialog, similar labels integration, MergeLog
6. **Polish:** Sample thumbnails, spot links, loading skeletons, error states

## 8. Verification

1. Open /steward → taxonomy section visible with stats cards
2. Filter by "Missing translations" → only incomplete labels shown
3. Click red dot → type translation → Save → dot turns green, coverage % updates
4. Expand a label → see similar labels with similarity scores
5. Click "Merge ←" on a duplicate → MergeDialog shows preview → Confirm → duplicate gone, items reassigned
6. "View all spots →" → navigates to filtered history
7. Toggle matrix view → see all labels × locales grid, edit inline
8. Check merge log → shows audit trail of merges
