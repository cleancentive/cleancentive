# Domain Glossary

This document defines the canonical vocabulary for Cleancentive. All user-facing text, documentation, API design, and code should use these terms consistently.

**Audience:** developers, designers, content writers, anyone contributing to the project.

---

## Core Concepts

### Spot

A geolocated, timestamped photo of litter. The atomic unit of data in Cleancentive.

Every submission creates a Spot. A Spot has a `picked_up` boolean (default: `true`). When `picked_up` is true, the Spot is a **Pick** (see below). When false, it represents litter that was reported but not collected (e.g., inaccessible, hazardous, too heavy for one person).

- **Used in:** data model, API, code
- **Example:** "The user logged 12 spots this week."

### Pick

A Spot where the litter was collected. This is the default and primary user-facing action. Most users will never change the default.

- **Used in:** UI, documentation, marketing
- **UI examples:** "Log a Pick", "My Picks", "3 picks today"
- **Relationship to Spot:** Every Pick is a Spot. Not every Spot is a Pick.

### Log

The verb for creating a Spot/Pick. Replaces "capture", "upload", and "submit" in user-facing text.

- **UI examples:** "Log a Pick" (button), "Log Pick" (short form)

### Detection

ML-powered identification of litter items in a photo. Used consistently everywhere — UI, code, admin, documentation. Replaces "analysis" in all contexts.

- **UI examples:** "Waiting for detection", "Detecting litter...", "Detection failed", "Retry detection"
- **Code:** `detection_started_at`, `detection_completed_at`, `detection_raw`, `LitterDetectionJobData`

### Sync

Transferring locally-queued data to the server. Replaces "upload" in user-facing text. Reflects the offline-first architecture where picks are queued locally and synchronized when connectivity is available.

- **UI examples:** "Waiting to sync", "Syncing...", "Sync failed"

### Item / Detected Item

A single piece of litter identified by detection within a photo. Has properties: category, material, brand, weight, confidence.

- **UI examples:** "3 items detected", "No detectable litter items were found."
- **Code entity:** `LitterItem` (or `DetectedItem`)

---

## Community

### Team

A group of users who pick litter together. Unchanged from current usage.

- **UI examples:** "Create a team", "Join a team", "Team members"

### Cleanup

An organized, community-scale litter removal activity. This is what the wider litter-picking community universally calls these (beach cleanup, park cleanup, community cleanup). Replaces "Event" in all contexts.

Can be one-time or recurring. When recurring, individual instances are identified by their **date** — no special term is needed.

- **UI examples:** "Saturday Park Cleanup", "Beach Cleanup — March 14th", "Join this cleanup", "Next cleanup: March 21st"
- **Code entity:** `Cleanup` (was `Event`)

### Participant

A user who joined a Cleanup.

- **Code entity:** `CleanupParticipant` (was `EventParticipant`)

### Organizer

A volunteer who leads a Team or Cleanup. The user-facing label for the elevated community role within a team or cleanup. Replaces "admin" in all community contexts.

- **UI examples:** "Organizer" badge on member lists, "Organizer Actions" section
- **DB value:** `'organizer'` in `team_memberships.role` and `cleanup_participants.role`
- **Distinct from:** Steward (platform-level), Admin (internal/technical only)

### Steward

A volunteer who maintains the CleanCentive platform and responds to user feedback. The user-facing label for people with platform-level access.

- **UI examples:** "Steward" nav link, "Steward" badge in feedback conversations
- **Route:** `/steward`
- **Distinct from:** Organizer (community role within teams/cleanups), Admin (internal code concept — `AdminGuard`, `adminStore`)

### Feedback

A user-submitted bug report, suggestion, or question. Creates a private conversation between the user and a Steward. Avoid "report" (banned term), "ticket" (too corporate), and "issue" (too technical for user-facing text).

- **UI examples:** "Send Feedback", "My Feedback", "Feedback" button
- **Code entity:** `Feedback`, `FeedbackResponse`

---

## User Lifecycle

### Guest

An anonymous user browsing without an account. Can capture photos but progress is not saved across devices.

### Magic Link

Passwordless email authentication. A secure link sent to the user's email to sign in.

### Nickname

The user's chosen display name. Required. Unique.

---

## Technical (admin & developer contexts only)

These terms are acceptable in admin UI and developer documentation but should not appear in end-user-facing text.

### Queue

Job processing queue (BullMQ). Named `litter-detection`.

### Worker

Background process that runs detection jobs on submitted photos.

### Outbox

Internal term for the local IndexedDB queue of pending syncs. The user-facing label for this concept is **Pending**.

### Purge

Automated deletion of data after a retention period. Configured via environment variables and disabled by default. Requires explicit admin opt-in.

### Processing Status

Server-side pipeline state for a Spot. Values and their user-facing labels:

| Internal Value | User-Facing Label |
|---|---|
| `queued` | Waiting for detection |
| `processing` | Detecting litter... |
| `completed` | Complete |
| `failed` | Detection failed |

---

## Wider Domain

These terms are used in the litter-picking community and may appear in documentation, marketing, and educational content.

### Litter

Discarded waste in public spaces. The core problem Cleancentive addresses.

### Litter Picking / Litter Pick

The activity of collecting discarded waste from public spaces. The established term in the UK and internationally. In the US, "picking up litter" or "litter cleanup" are more common.

### Plogging

Picking up litter while jogging. Coined in Sweden (from *plocka upp* "to pick up" + *jogging*). Started by Erik Ahlstrom around 2016.

### Pliking

Picking up litter while hiking or biking. A variation on plogging.

### Hotspot

A location with high litter density, identifiable from aggregated Spots. Useful for directing community cleanups to areas of greatest need.

### World Cleanup Day

Annual global cleanup initiative, held in September. Coordinates millions of volunteers worldwide.

### Adopt a Highway

Programs where groups commit to regularly cleaning stretches of road. Common in the US.

---

## Style Guide

1. Use **"pick"** when addressing users about their submissions — not "upload", "capture", "report", or "submission".
2. Use **"detection"** for ML processing — not "analysis". This applies everywhere: UI, code, admin, docs.
3. Use **"sync"** for offline-to-server transfer — not "upload".
4. Use **"cleanup"** for organized community activities — not "event".
5. Recurring cleanup instances are identified by their **date** — no special noun needed.
6. Never use **"report"** for Spots or Picks. "Report" is ambiguous with ops/monitoring/alerting concepts and is banned from the vocabulary.
7. **"Spot"** is the data model term; **"Pick"** is the default UI term. Both are correct in their respective contexts.
8. Technical terms (worker, queue, outbox) are for admin UI and developer docs only.
9. Use **"organizer"** for the elevated role within a team or cleanup — not "admin". The DB value is `'organizer'`.
10. Use **"steward"** for platform-level volunteers who respond to feedback and maintain the app — not "admin" in user-facing text.
11. Use **"feedback"** for user-submitted bug reports, suggestions, or questions — not "report", "ticket", or "issue".

---

## Competitor Landscape

| App | Primary Term | Picked Up vs. Not | Detection | Categorization |
|---|---|---|---|---|
| **OpenLitterMap** | (generic upload) | Toggle: "Picked Up" / "Still there" | Manual + auto | Object, Material, Brand tags |
| **Litterati** | (assumes picked up) | No distinction | Auto (LitterAi) | Object, Material, Brand |
| **Stridy** | "Stride" / "Pick-up" | Assumes picked up | Manual | Pre-loaded litter categories |
| **Cleancentive** | **Pick** (default) / **Spot** (base) | `picked_up` boolean, default true | Auto (ML) | Category, Material, Brand |

### Sources

- [OpenLitterMap](https://openlittermap.com/)
- [Litterati](https://www.litterati.org/app-faqs)
- [Stridy](https://stridy.com/stridy-app/)
- Wikipedia: [Clean-up (environment)](https://en.wikipedia.org/wiki/Clean-up_(environment)), [Litter](https://en.wikipedia.org/wiki/Litter), [Plogging](https://en.wikipedia.org/wiki/Plogging)
- [Cambridge Dictionary: litter picking](https://dictionary.cambridge.org/us/dictionary/english/litter-picking)
