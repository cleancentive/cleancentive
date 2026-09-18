# Passwordless Authentication

## Abstract

Guest-first passwordless auth using email magic links. Users start as anonymous guests, claim accounts by verifying an email, and manage multiple emails per account. Adding an email that belongs to another account triggers a merge flow requiring the other party's confirmation. Recovery sends magic links to all selected login emails.

## Core Concepts

**Guest-first identity.** Every visitor gets a client-side guest identity on first load (a UUIDv7 stored in localStorage). No database record is created until the guest performs a write operation (e.g., claiming an account via magic link). When they enter an email, a magic link is sent; clicking it "claims" the guest into a real account. If the email already belongs to an existing account, the guest is merged into that account on verification.

**Magic links as the only credential.** There are no passwords. All authentication happens through short-lived (24h) signed tokens delivered via email. A separate long-lived session token (365d) is issued after verification and used for subsequent API calls. The client silently refreshes the session token when it is within 30 days of expiry.

**Multi-email accounts.** A user can attach multiple emails. Each email is globally unique across users. Any subset of emails can be marked as "login emails" — these are the addresses that receive magic links during recovery.

**Merge as a special case of add-email.** When a user tries to add an email that belongs to another account, the system returns a conflict instead of failing. The user can then explicitly request a merge: the other account's owner receives a warning email and must click a confirmation link. On confirmation, all data from the target account transfers to the requester, and the target account is deleted.

**Account removal.** When a user removes their last email, they choose between full deletion (cascade delete all data) or anonymization (reset to guest state, keep related data like activity history).

**Recovery.** A user who lost access enters any email on their account. The system sends magic links to all emails marked for login, giving them multiple ways back in.

## Spec

### Data Model

- **User**: `id`, `nickname`, `full_name?`. A guest user has `nickname = "guest"` and no emails.
- **UserEmail**: `id`, `email` (globally unique), `is_selected_for_login` (boolean), belongs to one User.

### Token Types

| Token | Lifetime | Claims | Purpose |
|-------|----------|--------|---------|
| Magic link | 24h | `purpose = magic-link` | Delivered via email. Payload: `subject` (user id), `email`, optional `guest_id`. Recovery links are the same kind. |
| Add email | 24h | `purpose = add-email` | Confirms a new address. `subject` is the requester, so this must never be usable as a session. |
| Merge confirm | 24h | `purpose = merge-confirm` | Sent to the account being absorbed. Payload also carries `merge_into_user_id`. |
| Session | 365d | `typ = session` | Bearer token for authenticated API calls. Payload: `subject` (user id). Client refreshes silently when within 30d of expiry. |

All tokens are signed with the same secret, so the signature alone does not say
what a token may be used for. A token carrying a `purpose` is rejected as a
session, and a session token is rejected on the sign-in route. Tokens issued
before these claims existed carry neither and are still accepted as sessions so
that nobody is signed out for a problem they cannot see; drop that allowance
once the last pre-2026-09 token has expired.

### Flows

#### 1. Guest Initialization
On app load, check for a stored guest id in localStorage. If none exists, generate a UUIDv7 client-side and store it. No server call is made. The guest database record is created lazily on the first write operation (e.g., claiming an account via magic link).

#### 2. Login (Claim or Return)
Input: `email`, `guest_id?`.

- **Email not in system + guest provided:** send a magic link carrying the guest id. Nothing is written yet — the address is *not* associated until the link comes back verified. The guest id is client-supplied, so it is only accepted when it names an unclaimed guest (no row, or nickname `guest` with no emails); naming somebody else's account is refused silently.
- **Email not in system + no guest:** silent no-op (don't reveal whether email exists).
- **Email exists (returning user):** send magic link to that email. Embed `guest_id` in token so the verify step can merge the guest into the returning account.

The pending request also records the requesting browser and rough location, so
the device that opens the link can say who asked.

#### 3. Magic Link Verification
Input: token from email link.

- Validate token signature, expiry and `purpose` — a session token must not work here.
- Resolve who is signing in: if the address now belongs to an account, that account, and the claimed guest merges into it. Otherwise associate the address with the subject, which must still be an unclaimed guest.
- If the token contains a `guest_id` different from the subject: merge that guest in too.
- Issue a session token for the resulting user.
- Report whether a sign-in request is still waiting, and on which browser and location it was started.

**Verification does not complete the waiting request.** Completing it hands a
session to whoever is polling, so requesting a link for an address you do not
own and polling for the result was enough to take the account over the moment
the owner clicked. The browser that opened the link decides instead:

- **It started the request** (its own request id is in localStorage): complete it silently. This is the ordinary same-device sign-in and looks no different than before.
- **It did not**: show who asked and complete only on confirmation, via `POST /auth/pending/:id/complete`. Declining calls `DELETE /auth/pending/:id` so the other device stops waiting. Either way the device that opened the link is signed in.

#### 4. Add Email
Input: `email` (requires active session).

- **Email is free:** send a verification link (separate token with `purpose = add-email`). On click, associate the email with the user. New emails default to `is_selected_for_login = false`.
- **Email already on this account:** return `already-yours`.
- **Email belongs to another account:** return `conflict` with the other account's nickname. Do not send anything yet.

#### 5. Confirm Merge (second step after conflict)
Input: `email` (requires active session).

- Look up the target user who owns the email.
- Send a warning email to the target explaining: their data will transfer to the requester, their account will be permanently deleted, this cannot be undone.
- The warning email contains a confirmation link with a token (`purpose = merge-confirm`, `merge_into_user_id = requester`).

#### 6. Merge Confirmation
Input: token from warning email (no session needed — the link itself is the auth).

- Validate token has `purpose = merge-confirm`.
- Transfer all emails from the target (source) account to the requester (destination).
- Delete the source account.
- Redirect to frontend with a merge-complete indicator.

#### 7. Recovery
Input: `email`.

- Look up user by email. Silent no-op if not found.
- Collect all emails with `is_selected_for_login = true` (fall back to all emails if none selected).
- Send a magic link for each to the respective address. These are ordinary magic links (`purpose = magic-link`) and go through the same verification.

#### 8. Remove Email
Input: `email_id` (requires active session).

- If not the last email: delete it. If it was the only selected-for-login email, auto-select the first remaining.
- If last email: reject. Client must explicitly choose delete or anonymize.

#### 9. Delete Account
Cascade delete user and all associated data.

#### 10. Anonymize Account
Delete all emails, reset nickname to `"guest"`, clear full name. Keep related data (e.g. activity history) intact.

#### 11. Update Login Email Selection
Input: list of email ids (requires active session, at least one required).
Mark only the given emails as `is_selected_for_login`. These are the addresses used in recovery.

#### 12. Last-Seen Tracking
On page unload (`beforeunload`), the client sends a `sendBeacon` request with the session token. The server decodes the token, extracts the user id, and updates `last_login`. This tracks activity even with long-lived sessions where login events are rare. No throttle — fires on every tab close or navigation away, but not on minimize or tab switch.

#### 13. Logout
Client-side only: clear session token and guest id.

## Proposed REST API

All endpoints return JSON. Auth-protected endpoints expect `Authorization: Bearer <session_token>`.

### Authentication

| Method | Path | Auth | Body / Query | Response | Notes |
|--------|------|------|-------------|----------|-------|
| POST | `/auth/magic-link` | No | `{ email, guestId? }` | `{ success }` | Sends magic link. Silent no-op if email unknown and no guest. |
| GET | `/auth/verify` | No | `?token=<jwt>` | `{ userId, email, requestId, pendingSignIn }` + header `x-session-token` | Consumes magic link. Merges guest if applicable. Does **not** complete a waiting sign-in. |
| POST | `/auth/pending/:id/complete` | Yes | — | `{ success }` | Hand the waiting device a session. Only for the account the request was issued to. |
| DELETE | `/auth/pending/:id` | Yes | — | `{ success }` | Turn down a sign-in started elsewhere. |
| POST | `/auth/add-email` | Yes | `{ email }` | `{ status, ownerNickname? }` | Status: `verification-sent`, `already-yours`, or `conflict`. |
| GET | `/auth/verify-email` | No | `?token=<jwt>` | Redirect to frontend | Consumes add-email verification link. |
| POST | `/auth/add-email/confirm-merge` | Yes | `{ email }` | `{ success, sent }` | Sends merge warning to target account. |
| GET | `/auth/merge-confirm` | No | `?token=<jwt>` | Redirect to frontend | Consumes merge confirmation link. |
| POST | `/auth/recover` | No | `{ email }` | `{ success }` | Sends magic links to all login emails. Silent no-op if unknown. |
| POST | `/auth/refresh` | Yes | — | `{ token }` | Issue fresh session token. UserId extracted from Bearer token. |
| POST | `/auth/last-seen` | No | `{ token }` | 204 | Update `last_login`. Token in body (sendBeacon can't set headers). Silent fail on invalid token. |
| POST | `/auth/logout` | No | — | `{ success }` | No-op server-side (stateless JWT). |

### User / Profile

| Method | Path | Auth | Body / Query | Response | Notes |
|--------|------|------|-------------|----------|-------|
| GET | `/user/profile` | Yes | — | User object with emails | Current user profile. |
| PUT | `/user/profile` | Yes | `{ nickname?, full_name? }` | User object | Update profile fields. |
| DELETE | `/user/profile` | Yes | `?mode=delete\|anonymize` | `{ success }` | Delete or anonymize account. |
| DELETE | `/user/profile/email/:emailId` | Yes | — | User object | Remove email (fails if last). |
| PUT | `/user/profile/emails/selection` | Yes | `{ emailIds[] }` | Updated emails | Set which emails receive magic links. |
