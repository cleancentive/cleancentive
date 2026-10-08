# Credentials: sessions, personal access tokens, API keys

Three credentials reach the API. Two say **who** is calling, one says **which application** is calling.

| Credential | Format | Header | Identifies | Created by | Revocable |
|---|---|---|---|---|---|
| Session token | JWT (HS256, 365 d) | `Authorization: Bearer <jwt>` | a person (or a guest) | magic link, guest sign-up, device-code approval | only by rotating `JWT_SECRET` |
| Personal access token (PAT) | `cc_pat_` + 43 url-safe chars | `Authorization: Bearer cc_pat_…` | a person | that person, under Profile → Access tokens | yes, one at a time |
| API key | `cc_live_` + 43 url-safe chars | `X-API-Key: cc_live_…` | an application | a steward, under Steward → API keys | yes |

A request may carry a bearer token and an API key at the same time. That is the normal shape for a third-party client: the key says which app, the token says which user.

## Personal access tokens

- Act as the owner everywhere a session does, **except** on routes that change credentials. Those take an interactive session only and answer `403` to a PAT: creating/listing/revoking tokens, `POST /auth/refresh`, adding or removing emails, merge confirmation, device-code approval and rejection, account deletion/anonymisation, OIDC consent (`POST /oidc/authorize/complete`), and every steward route (`AdminGuard`).
- Stored as a SHA-256 hash; the plaintext is returned once by `POST /user/tokens`. The list shows the first 15 characters so the owner can tell tokens apart.
- Default expiry 90 days, at most 365, or `expiresInDays: null` for none. At most 25 active tokens per account.
- `last_used_at` is updated at most every five minutes.
- Anonymising an account revokes its tokens; deleting it removes them.
- Implementation: `backend/src/personal-access-token/`, `backend/src/auth/pat.strategy.ts` (a passport strategy tried before `jwt`; see `bearer-strategies.ts`), `backend/src/auth/session-only.guard.ts`.

## API keys

- Identify the application, never a user. **A key alone cannot create a spot**: spots belong to a user, and team attribution, de-duplication and leaderboards are per user. A browser game without a signed-in player can use a guest session (`POST /auth/guest`) as the user.
- Scopes: `read` (baseline, any request) and `write:spots` (required on `POST /spots`). A request whose key lacks the scope a route requires gets `403`.
- Each key has a per-minute budget (`rate_limit_per_minute`, default 60). Over budget answers `429`.
- A request carrying an unknown, revoked or expired key is refused with `401` **even on public routes**. This is deliberate: a misconfigured client should notice immediately rather than when its picks silently lose their attribution.
- Spots created with a key record it in `spots.source_api_key_id`; the steward list shows the count per key.
- A key that ships inside a browser app is public by nature. It gives attribution and a budget, nothing more. Never put a steward's PAT in a client.
- Implementation: `backend/src/api-key/` — a global `APP_GUARD` resolves the header on every request and sets `req.apiKey` without touching `req.user`.

## Budgets

| Limit | Scope | Env | Default |
|---|---|---|---|
| Spot creation per user | one account, one hour | `SPOT_CREATE_PER_USER_PER_HOUR` | 300 |
| Requests per API key | one key, one minute | per key, set when issued | 60 |

Both live in Redis (`backend/src/common/redis-rate-limit.ts`), so they survive restarts and replicas. Idempotent retries of the same upload are not counted.

## CORS

Any origin may call the API. Only origins in `CORS_ORIGINS` (falling back to `FRONTEND_URL`) may send credentials, and only they may be the host of a magic link. Because every credential travels in a header the caller sets itself, a page on a foreign origin can only present a token it already holds.

## Signing a user into a third-party app

- **Device code**: `POST /auth/device-code` → show the code → the user opens `https://cleancentive.org/auth/device?code=…` and approves → poll `GET /auth/device-code/:id` for the session token. Five-minute window.
- **Magic link**: `POST /auth/magic-link` → the user clicks the mail → poll `GET /auth/pending/:requestId`. The link opens cleancentive.org, where the user confirms.
- **Guest**: `POST /auth/guest` → a session for an anonymous visitor who can log picks but not join teams.
- OIDC tokens issued by `/oidc/*` are **not** accepted by the REST API (different signature scheme); OIDC exists for the wiki's single sign-on.

See the OpenAPI document at `/api/openapi.json` for request and response shapes.
