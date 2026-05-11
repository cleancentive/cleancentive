# Review Security

You are a security engineer reviewing the cleancentive monorepo. The app collects user-submitted photos with geolocation, uses passwordless magic-link auth, gates Steward/Admin features behind role checks, and exposes a public read API for the map. Produce a structured findings report.

## Setup

Before reviewing, load project context:

1. Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for project conventions
2. Read [docs/domain-glossary.md](docs/domain-glossary.md) for canonical terms (Steward vs Admin distinction matters here)
3. Skim [docs/architecture/](docs/architecture/) for the trust boundary view

Then read security-relevant source files:

Backend (the trust boundary between client and server):
- `backend/src/**/*.controller.ts` (every HTTP entry point)
- `backend/src/**/*.guard.ts` (authn/authz enforcement)
- `backend/src/**/*.strategy.ts` (Passport strategies)
- `backend/src/**/*.service.ts` (business logic — focus on auth, feedback, OIDC, spot, user)
- `backend/src/**/*.dto.ts` (input validation)
- `backend/src/auth/**/*.ts` (magic-link issuance + redemption, JWT, session)
- `backend/src/oidc/**/*.ts` (OIDC integration, role sync)
- `backend/src/**/*.entity.ts` (data shapes that may be returned to clients)
- `backend/src/main.ts` (CORS, Helmet, global pipes/filters, body limits)
- `backend/src/app.module.ts` (global guards/interceptors)

Frontend (to understand what the client sends and what gets exposed):
- `frontend/src/**/*.{ts,tsx}` — focus on API clients, auth flow, file upload, role-gated UI

Infrastructure (only for surface review):
- `infrastructure/docker-compose.prod.yml` — exposed ports, env wiring
- `infrastructure/Caddyfile*` — TLS termination, headers

## Check categories

Run each check below. For each finding, record: `{file, line, severity, category, message}`.

### 1. Authorization correctness (severity: error)

- **Steward/Admin gating** — every protected endpoint must enforce role via a guard (`@UseGuards(JwtAuthGuard, StewardGuard)` or equivalent). Walk every controller and list endpoints whose action is privileged but whose decorator stack does NOT include the role guard.
- **Default-deny** — controllers without an explicit guard should be either explicitly public or default-denied via a global guard. Confirm the chosen posture and flag inconsistencies.
- **Public-read endpoints** — `/api/v1/spots` and similar map data must verify what they return is truly safe to expose anonymously (no draft spots, no soft-deleted, no email/userId leakage in response).
- **OIDC role sync** — verify that role membership flows from the OIDC provider to the local user record correctly and that a user removed from the Steward group at the IdP loses access in cleancentive promptly (or at next login at the latest).
- **Role check correctness** — verify that `user.roles.includes('steward')` or equivalent uses canonical role names from `docs/domain-glossary.md` (Steward, Admin) and is not stringly-typed in a way that typos would silently grant access.

### 2. Authentication (magic-link, JWT, OIDC) (severity: error)

- **Magic-link tokens**:
  - Generated with a CSPRNG (e.g., `crypto.randomBytes`), not `Math.random`
  - Sufficient entropy (≥128 bits)
  - Stored hashed (not raw) in the DB
  - Bound to the email they were issued for
  - Single-use — redemption marks the token consumed atomically; a second redemption fails
  - Short TTL (minutes, not hours/days)
  - Not logged in plaintext
  - Rate-limited per email and per IP at issuance
- **JWT**:
  - Signed with a strong secret loaded from env (not committed); algorithm is HS256/RS256, not `none`
  - Short access-token TTL; refresh strategy (if any) is sound
  - `audience` / `issuer` claims validated by the strategy
  - Token sent via `Authorization` header or `Secure; HttpOnly; SameSite` cookie — never localStorage if cookies are an option
- **OIDC**:
  - State + nonce parameters used and verified
  - Redirect URI is allowlisted, not user-controlled
  - ID token signature verified against the IdP JWKS
  - Client secret loaded from env, not in the repo

### 3. Data minimization (severity: warning)

Build a per-endpoint table of exactly what is returned to the client, by audience:

| Method | Path | Auth required | Audience (anon/user/steward/admin) | Fields returned | Sensitive? |
|--------|------|---------------|------------------------------------|-----------------|------------|

- Flag any anonymous endpoint that returns user emails, raw GPS coordinates with PII risk, IP addresses, or moderation notes.
- Flag any endpoint that returns `User` entities directly without a response DTO — TypeORM entities can leak fields (passwordHash, internal flags) if returned naively.
- Verify private feedback conversations are scoped to participants + Stewards only.
- Verify error responses do not leak internal state (no stack traces, no SQL errors, no file paths in responses). Confirm a global exception filter sanitizes errors.

### 4. Input validation (severity: error)

- **DTOs with class-validator** — every controller body/query/param must be a DTO with `class-validator` decorators, not a raw `any` / `Record<string, unknown>`. The global `ValidationPipe` must be configured with `whitelist: true, forbidNonWhitelisted: true, transform: true` in `main.ts`. Flag any deviation.
- **File uploads (Multer)**:
  - Max file size set (per file and per request)
  - Max file count set
  - MIME allowlist (`image/jpeg`, `image/png`, `image/webp`, `image/heic`) enforced server-side, not just client-side
  - Magic-byte sniffing (not just trusting the `Content-Type` header) where feasible
  - File extension validation aligned with MIME
  - Stored under a server-controlled S3 key — never use client-supplied filenames in the key path
  - Path-traversal-safe S3 key construction (`spots/<userId>/<spotId>/<uuid>.<ext>` pattern; reject `..`, `/`, null bytes)
  - EXIF stripped or sanitized before publishing the image (GPS in EXIF can be more precise than the user intended)
- **Geo-coordinate bounds** — latitude in [-90, 90], longitude in [-180, 180], reject NaN/Infinity. Reject zero/zero unless explicitly allowed.
- **SQL injection** — TypeORM repositories with parameterized queries are safe; flag any `query(`...${var}...`)` raw SQL with interpolation, especially in PostGIS queries (`ST_Within(...)` etc.).
- **Server-Side Request Forgery (SSRF)** — any endpoint that fetches a URL on behalf of the user (avatar fetcher, link unfurl, etc.) must allowlist hosts and disallow internal ranges (10/8, 172.16/12, 192.168/16, 127/8, ::1, link-local).

### 5. Trust boundaries (severity: error)

- `req.user` populated by Passport (after `JwtAuthGuard`) is **trusted**. Body, query, params, headers (other than the validated `Authorization`) are **untrusted**.
- Find any code that takes `userId` / `email` / `role` from the request body or query when it should come from `req.user`. Common bugs: `body.userId` used as the owner of a created spot; `body.role` accepted in a profile update.
- Find any code that takes `spotId`, `pickId`, `feedbackId` from the request and acts on it without verifying the caller owns it (or has a role permitting cross-user access).
- Verify guards run BEFORE pipes that touch the DB — otherwise an unauthenticated request hits the DB.
- Verify CORS is configured to a specific origin in prod, not `*`. Flag any wildcard with credentials.

### 6. File upload and storage security (severity: warning)

- **S3 bucket policy** — uploaded photos must not be world-listable; only individual objects should be reachable via presigned URLs or via the app's read endpoint. Flag if the bucket allows `s3:ListBucket` to anonymous.
- **Presigned URL scoping** — if presigned URLs are used for upload, scope tightly: short TTL (≤10 min), PUT only, exact key, content-length range, content-type pin. Flag broad presigns.
- **Thumbnail pipeline** — verify the thumbnail is regenerated server-side from the original; the client must never be allowed to upload a "thumbnail" directly that bypasses the moderation pipeline.
- **CDN / public URL** — if photos are served via CDN, verify the URL is unguessable (UUID in path) so deleted spots are not trivially enumerable.

### 7. Operational security (severity: warning)

- **Secrets** — verify no real secrets in the repo (DB passwords, JWT secret, SMTP creds, OIDC client secret, S3 keys). All prod secrets should come from `cleancentive-private` per AGENTS.md. Flag any committed `.env` or hardcoded secret. Run a quick grep for high-entropy strings, `password`, `secret`, `key` in source.
- **CORS** — prod origin allowlist (not `*`); credentials handling consistent with the auth model.
- **CSRF** — if any endpoint uses cookie auth, CSRF protection (SameSite=strict/lax + token) is required. If purely Bearer-token, document that CSRF is not applicable.
- **Rate limiting** — `/auth/magic-link/issue`, `/auth/magic-link/redeem`, `/feedback`, `/spots` (POST). Verify rate limits exist and are enforced per IP and per user. Flag missing limits.
- **Helmet / security headers** — verify `helmet()` or equivalent is registered in `main.ts`. Verify Caddy or backend sets `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- **Cookie flags** — any session cookie must be `Secure; HttpOnly; SameSite=Lax` (or stricter) in prod.
- **Dependency hygiene** — flag any dependency with known critical CVEs (don't run a full audit, but eyeball `package.json` for obviously outdated or unmaintained packages).

## Output format

Produce a Markdown report with this structure:

```
## Security Review — {date}

### Summary
- Critical: {count}
- Errors: {count}
- Warnings: {count}
- Info: {count}
- Overall security posture: {strong/adequate/weak} with rationale

### Trust Boundary Map
{Brief description of what the client can and cannot control, which guards protect which controllers, and where the trust transitions occur (Passport strategy → req.user, ValidationPipe → DTO, file pipeline → S3)}

### Critical / Errors (must fix)
#### [{category}] {title}
**File:** {file}:{line}
**Attack vector:** {how an attacker could exploit this}
**Impact:** {what goes wrong}
**Recommendation:** {specific fix}

### Warnings (should fix)
#### [{category}] {title}
**File:** {file}:{line}
**Risk:** {what could go wrong}
**Recommendation:** {specific fix}

### Info (observations)
#### [{category}] {title}
**File:** {file}:{line}
**Note:** {observation}

### Endpoint Inventory
| Method | Path | Auth required | Audience | Guard(s) | Returns | Sensitive? |
|--------|------|---------------|----------|----------|---------|------------|
| GET    | /api/v1/spots | no | anon | none | ... | ... |
| POST   | /api/v1/spots | yes | user | JwtAuthGuard | ... | ... |
| POST   | /api/v1/admin/... | yes | admin | JwtAuthGuard, AdminGuard | ... | ... |
| ...    | ... | ... | ... | ... | ... | ... |

### Recommendations
{Prioritized list with estimated t-shirt sized effort and impact}
```

Be context-aware: NestJS provides built-in protections (DI, ValidationPipe, exception filters); Caddy terminates TLS; the app uses Bearer JWTs from a passwordless flow. Standard Nest patterns (`@UseGuards`, DTOs, global pipes) are the expected baseline — do not flag them as missing if they are in place. Focus on application-level issues specific to cleancentive: authorization model correctness around Steward/Admin, magic-link safety, file upload + EXIF, public map data exposure.

## Apply changes

After completing the review, implement all fixes from the "Critical / Errors" and "Warnings" sections. Apply changes directly — do not ask for confirmation on individual fixes. Respect AGENTS.md: if a fix requires a schema change, add a migration in `backend/src/migrations/`.

After all changes are applied, run only the workspaces you touched:

- Backend touched: `bun run --filter '@cleancentive/backend' lint && bun run --filter '@cleancentive/backend' test`
- Frontend touched: `bun run --filter '@cleancentive/frontend' lint && bun run --filter '@cleancentive/frontend' test`
- Both: `bun lint && bun test` from the repo root.
