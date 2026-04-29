# Cleancentive ↔ Outline ↔ Umami integration

## Context

Outline is embedded as the wiki for Cleancentive (SSO via OIDC, user/group sync via OutlineSyncService, Umami analytics on both the main app and the wiki). This document catalogues the current state, lifecycle gaps, integration opportunities, and tracks the roadmap — with **Cleancentive as the leading system** and **zero manual setup steps** (this is an idempotent, GitOps-managed project; all server state must be reproducible via automation).

## Current state

| Layer | Mechanism | What it does |
|---|---|---|
| Auth | Cleancentive is OIDC provider (`backend/src/oidc/`) | SSO into wiki via magic link; `sub` = Cleancentive user UUID |
| User sync | OutlineSyncService (`backend/src/outline-sync/`) — direct SQL on Outline DB | Pushes display name, avatar, admin role, per-team group membership in real-time |
| Analytics (main app) | Umami website `171465c9-…`, `umami.identify()` with Cleancentive UUID + communication emails | Linked user sessions |
| Analytics (wiki) | Umami website `2b593ee1-…`, Outline's built-in plugin | Anonymous sessions — Outline never calls `identify()` |
| Branding | `infrastructure/setup-outline.ts` | Sets workspace avatar to Cleancentive logo |
| Frontend | Link in dev browser launcher only | No wiki content surfaced in the main app |

### Identity mapping

| Concept | Cleancentive | Outline | Umami |
|---|---|---|---|
| User ID | `users.id` (UUID) | `users.id` (separate UUID, linked via OIDC `sub`) | Distinct ID (string, max 50 chars) |
| Email | `user_emails.email` (multiple per user, `is_selected_for_login` flag) | `users.email` (single, from OIDC userinfo — first/primary email) | Session property `email` (comma-joined selected emails) |
| Groups / spaces | Teams (`teams`) | `groups` (externalId = Cleancentive team UUID), `collections` (mapped via `team_outline_collections`) | N/A |

### Outline API and webhooks

Outline exposes a full RPC-style REST API (POST-only, JSON). Base: `https://wiki.cleancentive.local/api/:method`. Auth via API key (`ol_api_*`) or OAuth. Webhook infrastructure exists (`webhook_subscriptions` + `webhook_deliveries` tables) but no subscriptions are configured yet.

## Lifecycle model

Cleancentive is the leading system. OutlineSyncService pushes changes into Outline **reactively on events**, not via polling or periodic reconciliation. External IDs link entities (`groups.externalId` = team UUID; `team_outline_collections` mapping for collections; users linked by email).

### Events and handlers (current)

| Cleancentive change | Event | Outline side effect |
|---|---|---|
| User profile changed | `user.profile-changed` | `users.name` updated by email lookup |
| User avatar changed | `user.avatar-changed` | `users.avatarUrl` updated by email lookup |
| Admin promoted | `admin.promoted` | `users.role='admin'` + Stewards group |
| Admin demoted | `admin.demoted` | `users.role='member'` − Stewards group |
| Team member joined | `team.member-joined` | Team group created lazily + membership added |
| Team member left | `team.member-left` | Membership removed |
| Team renamed | `team.renamed` | Team group renamed; collection renamed (once mapped) |
| Team archived | `team.archived` | Team group members cleared; collection revokes team group (once mapped) |
| Team created | `team.created` | Collection provisioned, team group granted read/write (once mapping table exists) |
| Account anonymized | `user.anonymized` | Outline user suspended (tombstone emails in payload) |
| Account deleted | `user.deleted` | Outline user suspended (tombstone emails in payload) |

### Known drift/gap characteristics

- Push-direction, reactive-only — no periodic reconciliation. Downtime or dropped events cause silent drift.
- Outline-side edits to synced objects are overwritten on the next push event.
- Outline-side deletions are **not** auto-restored (treated as intentional admin action, logged).
- Hard deletes of users are avoided — we suspend (`suspendedAt`) instead of deleting, to preserve audit trail and avoid cascading to authored documents.

## Roadmap

Legend: ✅ done — 🚧 in progress — ⬜ not started

### ✅ Fix infrastructure-level Umami regressions
- Script URL over HTTPS so Caddy dev doesn't block mixed content
- `scriptName` in Outline's Umami integration so the script src resolves
- `umami.identify()` on main app with Cleancentive UUID + communication emails

### ✅ Close lifecycle gaps (team rename/archive, account anonymize/delete)
- Emit `team.renamed`, `team.archived`, `user.anonymized`, `user.deleted` with tombstone payloads (emails captured before DB deletion so OutlineSync can still resolve the Outline user)
- OutlineSync handlers rename the group, clear archived team's group members, suspend Outline user on anonymize/delete

### ✅ Auto-provision Outline collections per team

**Status:** complete. Mapping table, entity, event emission, handlers, backfill, and **automated API key provisioning** are all in place. No manual step required anywhere in the pipeline.

**Design:**
- `team_outline_collections` mapping table (`team_id UUID UNIQUE FK → teams(id) ON DELETE CASCADE`, `outline_collection_id varchar`)
  - Cleancentive-owned, not derived from Outline-editable fields (description/slug/DataAttributes), so Outline-side renames don't break the link
- `team.created` emitted from `TeamService.createTeam()`
- OutlineSyncService:
  - `provisionTeamCollection()` — POST `/api/collections.create` (private, no default access), then POST `/api/collections.add_group` with `read_write` for the team group, then save mapping
  - Extended `team.renamed` handler — POST `/api/collections.update` with the new name
  - Extended `team.archived` handler — POST `/api/collections.remove_group` to revoke team group access (content preserved, admin-only)
  - `backfillTeamCollections()` — for every non-archived team without a mapping on startup, provision it
- Collection deleted in Outline → do **not** auto-recreate (treat as intentional); log warning. A nightly reconciliation job is a follow-up item (medium priority).

**Why archive over hard-delete:** wiki content has long-term documentation value (past event reports, team agreements). Outline has no public `collections.archive`; revoking group access preserves content while removing team-member visibility.

#### Automated Outline API key provisioning

**Approach — runtime, ephemeral, in-process:** `OutlineSyncService` provisions its own API key at startup, stores it in memory only, and regenerates on every restart. No env var, no filesystem writes, no manual UI step.

**Outline API key mechanics (verified against source):**
- Format: `ol_api_` + 38-char word string (`[A-Za-z0-9_]{38}`)
- Hash: plain **SHA-256 hex** (`crypto.createHash('sha256').update(plaintext).digest('hex')`) — no salt, no bcrypt, deterministic
- Auth lookup: matches either the legacy `secret` column or `hash(input)`
- Table `"apiKeys"` (camelCase). Key columns: `id uuid PK`, `name varchar`, `hash varchar UNIQUE`, `last4 varchar(4)`, `userId uuid`, `scope varchar[]` (null = full access), `deletedAt timestamptz` (paranoid soft-delete)

**Startup flow** (in `OutlineSyncService.onModuleInit`, after `cacheOutlineTeamAndAdmin()`):
1. Soft-delete existing rows with `name = 'cleancentive-sync'` (set `deletedAt = NOW()`) — cleans up after prior process instances
2. Generate plaintext: `ol_api_${randomBytes → [A-Za-z0-9_]{38}}`
3. Insert fresh row: hash = SHA-256(plaintext), `userId` = `this.outlineAdminUserId`, `scope` = NULL (full), `last4` = plaintext.slice(-4)
4. Store plaintext in `this.outlineApiKey` (private mutable field)

All downstream `callOutlineApi()` calls use the in-memory key.

**Graceful degradation:** if Outline DB is unreachable at startup, the existing `onModuleInit` catch already logs and continues. `callOutlineApi` returns `null`; team creation still succeeds; collection provisioning is skipped silently.

**Horizontal scaling:** the backend runs as a single instance today — this is fine. If multiple backends ever run concurrently, switch to a per-instance key name (`cleancentive-sync-${instanceId}`) or a coordination lock. Not in scope.

### ⬜ Surface wiki content in the main app
- **Search:** `documents.search` API, expose wiki results in a Cleancentive search bar / command palette
- **Links:** show "Wiki docs for this team" on team/cleanup pages via `documents.list` filtered by collection
- **Embed:** use public share links in iframes for landing-page content (cleanup instructions, team guidelines)

### ⬜ Reconciliation job (nightly safety net)
- Nightly task diffs Cleancentive teams vs Outline collections with matching mapping rows
- Creates missing, updates renamed, warns on orphan Outline collections
- Required because reactive-only sync misses events lost to downtime

### ⬜ Outline → Cleancentive webhooks
- Register a webhook subscription on the Outline side pointing at a new Cleancentive backend endpoint
- Verify `Outline-Signature` header (HMAC-SHA256), respond within 5s, process async
- Events: `documents.*`, `comments.create`, `shares.*`, `users.*`
- Enables activity feed, notifications, gamification (points for wiki contributions)

### ⬜ Replace direct DB writes with Outline REST API
- OutlineSyncService currently writes to `users`, `groups`, `group_users` via SQL — risks breaking on Outline schema changes
- Switch to `users.update`, `groups.create`, `groups.add_user`, `groups.remove_user`
- Now easy because API key is auto-provisioned
- Will benefit from the reconciliation job as an additional safety net

### ⬜ Wiki-aware Umami identification
- Outline's Umami plugin injects the tracking script but never calls `identify()`
- Options (in rough order of robustness):
  1. Caddy response-body filter injecting a small `<script>` that reads Outline's client-side user state and calls `umami.identify()` — fragile, couples to Outline internals
  2. Upstream PR to Outline's Umami plugin adding `identify()` support — proper but slow
  3. Accept anonymous wiki sessions — simplest, fine if wiki analytics stay aggregate-only
- Low priority given the main app carries most attribution-relevant events

### ⬜ Auto-generated wiki content
- Seed templates: cleanup reports, team guidelines (`documents.create` with `template: true`)
- After a cleanup event ends, auto-create a summary document in the team's collection with stats

### ⬜ Comments ↔ messages bridge
- Webhook on `comments.create` cross-posts wiki doc comments into the team's Cleancentive message thread
- Optionally bidirectional: Cleancentive messages referencing a wiki doc post back as Outline comments via `comments.create`

## Prioritisation

| Priority | Item | Status |
|---|---|---|
| High | Fix lifecycle gaps | ✅ done |
| High | Auto-provision collections per team (incl. automated API key) | ✅ done |
| High | Surface wiki links on team pages | ⬜ |
| Medium | Reconciliation job | ⬜ |
| Medium | Webhooks for activity feed | ⬜ |
| Medium | Replace direct DB with API | ⬜ |
| Low | Wiki-side Umami identification | ⬜ |
| Low | Auto-generated content | ⬜ |
| Low | Comments bridge | ⬜ |

## Next steps

The next item on the roadmap is **Surface wiki links on team pages** (High). Suggested smallest viable cut:
- Backend: add a small endpoint that returns the Outline collection ID for a given team (looking up the `team_outline_collections` mapping); 404 if not yet provisioned.
- Frontend: on the team page, fetch the mapping and render a "Wiki" link to `https://wiki.cleancentive.local/collection/{id}`.

After that, the **Reconciliation job** is a natural follow-up since it pairs with the new collection lifecycle to backstop reactive-only sync.

### How to verify the auto-provisioning end-to-end
1. **Clean bootstrap:** start backend against a fresh Outline DB → exactly one row in `"apiKeys"` with `name='cleancentive-sync'`, `deletedAt IS NULL`.
2. **Restart cycle:** restart backend → previous row has `deletedAt` set, new row is active — exactly one live `cleancentive-sync` key at any time.
3. **End-to-end team flow:** create a team via the frontend → Outline collection appears, team group has `read_write`. No manual step anywhere.
4. **Failure mode:** stop the Outline Postgres → create a team → backend still works, sync skipped silently.
