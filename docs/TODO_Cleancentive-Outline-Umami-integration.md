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

### ✅ Surface wiki content in the main app
- "Wiki ↗" link on the team detail page opens that team's Outline collection. Hidden when the mapping isn't yet provisioned (transient — fixed at next sync tick).
- Backend extends `GET /teams/:id` with `outlineCollectionId`; frontend reads it via `currentTeam.outlineCollectionId` and composes `${WIKI_URL}/collection/<id>`.
- Search and full-collection embeds remain deferred — see "Future" below.

### ✅ Durable integration queue + reconciliation job
- BullMQ integration queue (`cleancentive-integrations`) owns Outline bootstrap and sync jobs.
- Successful Outline OIDC token exchange enqueues `outline.bootstrap`; backend startup also enqueues it as a missed-event safety net.
- Cleancentive domain events enqueue durable Outline sync work instead of relying on direct in-process side effects.
- BullMQ repeatable reconciliation job runs daily at 03:30 UTC.
- For each non-archived team: provisions missing mappings, renames Outline collections that drift from the Cleancentive name, warns on collections that vanished (does **not** auto-recreate).
- For each archived team with a mapping: idempotently re-revokes team group access (self-heal of missed `team.archived` events).
- Logs orphan mapping rows where the Cleancentive team is gone.

### ✅ Outline → Cleancentive webhooks
- HMAC secret auto-provisioned at startup (stored in `outline_webhook_config`); webhook subscription auto-registered in Outline (`webhook_subscriptions`).
- `POST /api/v1/outline-webhooks/incoming` verifies the `Outline-Signature` (`t=<ms>,s=<sha256_hex>`) using `timingSafeEqual` over the raw body, persists each event into `outline_events`.
- Subscribed events: `documents.create`, `documents.update`, `documents.delete`, `documents.archive`, `comments.create`. Easy to widen later — change the constant and restart.
- Activity-feed UI / notifications / gamification on top of `outline_events` are follow-ups.

### ✅ Replace direct DB writes with Outline REST API
- All user/group/group-membership writes in OutlineSyncService now go through `/api/users.update`, `/api/users.update_role`, `/api/users.suspend`, `/api/groups.create`, `/api/groups.update`, `/api/groups.add_user`, `/api/groups.remove_user`.
- Direct SQL retained only for: API-key bootstrap, webhook-subscription bootstrap (chicken-and-egg), and read-only lookups (`findOutlineUserId`, `findGroupIdByExternalId`).
- The bulk wipe of `group_users` on team archive is now a loop calling `groups.remove_user` per member.

### ⛔ Wiki-aware Umami identification — won't do
- Outline's Umami plugin doesn't call `umami.identify()`. The three workarounds (Caddy body filter, upstream PR, custom Outline image) all trade fragility or maintenance burden for a low-value gain — wiki traffic is low-volume and the main app carries the attribution-relevant events.
- Decision: accept anonymous wiki sessions. Revisit only if wiki analytics become a primary attribution surface.

### ✅ Seed each new collection with a starter doc
- `provisionTeamCollection` publishes a "Welcome to the {team} wiki" markdown doc into the new collection so it isn't blank on first visit.
- Failure of this final step is non-fatal — collection still exists; users can write their own content.

## Future

Out of scope for the current pass; revisit when use cases are concrete:
- **Wiki search / `documents.search`** in the main app's search bar or command palette.
- **Cleanup-summary docs**: after a cleanup event ends, auto-create a summary in the team's collection with stats.
- **Document templates** (`documents.create` with `template: true`) for cleanup reports and team guidelines.
- **Comments ↔ messages bridge**: cross-post `comments.create` webhooks into team threads (and the reverse via `comments.create` API).

## Prioritisation

| Priority | Item | Status |
|---|---|---|
| High | Fix lifecycle gaps | ✅ done |
| High | Auto-provision collections per team (incl. automated API key) | ✅ done |
| High | Surface wiki links on team pages | ✅ done |
| Medium | Reconciliation job | ✅ done |
| Medium | Webhooks for activity feed | ✅ done (receive path) |
| Medium | Replace direct DB with API | ✅ done |
| Low | Wiki-side Umami identification | ⛔ won't do |
| Low | Seed doc on collection provisioning | ✅ done |
| Low | Auto-generated cleanup summaries | future |
| Low | Comments bridge | future |

All scoped integration work is in. Activity-feed UI / cleanup-summary docs / comments bridge are now standalone features to plan when their use cases concretise.
