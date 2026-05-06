# Outline Permission Model

Cleancentive uses Outline as the team wiki. Cleancentive owns identity, team membership, steward status, and initial wiki bootstrapping. After a collection is created, Outline owns collection permissions, document permissions, and public shares.

## User Groups

| Cleancentive audience | Outline representation | Access model |
|---|---|---|
| Anonymous internet visitor | No Outline user | Reads only published Outline shares. |
| Authenticated Cleancentive user | Outline `member` role | Can read normal workspace collections. Can write where collection permission allows it. |
| Team member | Outline `member` role plus team group | Team group receives initial write access to its team collection. |
| Steward | Outline `admin` role plus `Stewards` group | Can administer Outline and steward collections. |

Outline's `member` role is displayed as "Editor" in Outline. Cleancentive user-facing copy should still use "team member" and "steward".

## Collection Baseline

Cleancentive creates these collections during manual initialization:

| Collection | Initial Outline permission | Initial group grant | Initial public share | Purpose |
|---|---|---|---|---|
| `Getting Started` | `read_write` | none | no | Authenticated-user guidance for using Outline and understanding permissions. |
| Team collection | `read` | Team group `read_write` | yes | Public-readable team wiki. Team members can edit. |
| `Stewards` | `read` | `Stewards` group `admin` | yes | Public-readable steward documentation. |
| `Stewards Confidential` | private (`null`) | `Stewards` group `admin` | no | Steward-only notes. |

## Ownership Boundary

Cleancentive continuously syncs:

- Outline users' platform role when a Cleancentive user becomes or stops being a steward.
- Membership in Outline groups from Cleancentive team membership and steward status.
- New team wiki initialization when a new Cleancentive team is created.

Cleancentive initializes once, then leaves alone:

- Collection permissions.
- Document permissions.
- Public shares.
- Manual cross-team grants.
- Manual share revocation.
- Collection names after creation.

If a team revokes a public share, Cleancentive treats that as intentional and does not recreate it during normal sync. The manual initialize endpoint may complete a missing initial share only for a partially initialized mapping created by the initializer itself.

## Stewards Team

`Stewards` is a first-class Cleancentive team with `system_key = 'stewards'`. It appears under Teams for everyone. Membership is managed by the platform steward role, not by manual joins, email-domain rules, or team organizers.

The app rejects manual membership and management actions for the system Stewards team. The frontend hides join, leave, edit, archive, promote, and partner-settings controls for it.

## One-Time Wipe And Init Runbook

The current Outline content is considered obsolete for this transition. Perform this sequence exactly once per environment after deploying this code and signing into Outline once via SSO so the Outline workspace exists.

1. Ensure Cleancentive and Outline are running and the backend has a steward-authenticated user.
2. Call `POST /api/v1/outline-maintenance/wipe-content` with body `{ "confirmation": "WIPE_OUTLINE_CONTENT" }`.
3. Call `POST /api/v1/outline-maintenance/initialize-content`.
4. Verify `Getting Started`, team collections, `Stewards`, and `Stewards Confidential` exist in Outline.
5. Verify team collections and the public `Stewards` collection have published shares.
6. Verify `Getting Started` and `Stewards Confidential` do not have public shares.

The wipe and initialize endpoints record completion in Cleancentive and reject later repeats after a successful run. The wipe uses the Outline database for Outline content and the Cleancentive database for mapping rows. These are separate databases, so the mapping cleanup cannot be part of the same Postgres transaction as the Outline wipe. If the wipe succeeds but mapping cleanup fails, rerun the wipe endpoint before initialization.

## Local And Production Notes

Local development URLs use `https://cleancentive.local` and `https://wiki.cleancentive.local`. Production uses the deployed Cleancentive API and wiki host.

Do not SSH into production to modify Outline manually. Deploy the code, use the guarded maintenance endpoints for the one-time wipe/init, then let normal sync handle only identity and membership.
