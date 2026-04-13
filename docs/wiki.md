# Outline Wiki Integration

## Rationale

We want to integrate Outline wiki (https://wiki.cleancentive.org) with cleancentive backend's existing magic-link authentication via OIDC. This allows users to log in once to cleancentive and access the wiki without a separate registration.

**Key requirements:**
- Users authenticate via magic links (existing cleancentive auth)
- Single sign-on between cleancentive app and Outline wiki
- Preserve 365-day token lifetime for cross-browser login
- Run locally for testing before deploying to production
- Use Colima for Docker runtime (as specified by user)
- Keep ports consistent across dev stack

## Key Decisions

1. **OIDC instead of SAML** - OIDC is simpler to implement and Outline has built-in OIDC support
2. **Custom OIDC provider in backend** - Implemented as a NestJS module (`/backend/src/oidc/`) rather than using a third-party OIDC provider
3. **PostgreSQL for token storage** - Using existing cleancentive PostgreSQL with TypeORM entities for authorization codes and refresh tokens
4. **PKCE support** - Added for security (required by Outline)
5. **localhost for local dev** - Changed OIDC_ISSUER_URL from `host.docker.internal:3000` to `localhost:3000` so Outline container can reach the backend running on the host

## Current Implementation State

### Completed

**OIDC Module Created:**
- `backend/src/oidc/oidc.entity.ts` - TypeORM entities (OidcAuthorizationCode, OidcRefreshToken, OidcClient) with explicit snake_case column mappings
- `backend/src/oidc/oidc.service.ts` - OIDC logic (JWKS, token minting, PKCE)
- `backend/src/oidc/oidc.controller.ts` - REST endpoints (discovery, authorize, token, userinfo, revoke, callback)
- `backend/src/oidc/oidc.module.ts` - NestJS module registered in AppModule

**Database:**
- Tables created: `oidc_authorization_code`, `oidc_refresh_token`, `oidc_client`
- OIDC client registered: `client_id=outline`, `client_secret=outline-dev-secret`

**Docker Configuration:**
- Updated `infrastructure/docker-compose.dev.yml` with `OIDC_ISSUER_URL=http://localhost:3000/api/v1/oidc`
- Outline service configured with OIDC client credentials

**Working:**
- OIDC discovery endpoint returns valid config: `http://localhost:3000/api/v1/oidc/.well-known/openid-configuration`

### Known Issues

1. **Outline container restarts** - When backend isn't running on port 3000, Outline fails OIDC discovery and quits
2. **OIDC tables need a migration** - `synchronize` currently creates tables in dev only. Before deploying, add a migration for `oidc_authorization_code`, `oidc_refresh_token`, and `oidc_client` and set `synchronize: false`.
3. **Blank page after logout → re-login (Outline upstream bug)** — After logging out of Outline and logging back in via SSO, the user lands on their previously-visited path (e.g. `/collection/welcome-…/recent`) with a blank page. Workaround: press `Cmd+R` / `F5` once. Root cause: Outline restores `lastVisitedPath` via client-side navigation before its auth stores finish re-hydrating, so the layout tree resolves to `null`. Not fixable from our OIDC side — `lastVisitedPath` is wiki-origin localStorage. Filing upstream TBD.

### Resolved

- **Backend SyntaxError on startup** — `oidc.controller.ts` used `import { Request, Response } from 'express'`, which fails under Bun because Express is CommonJS and does not export these as named values (they are types from `@types/express`). Fixed by switching to `import type { Request, Response } from 'express'`, matching the pattern in `auth.controller.ts` and `spot.controller.ts`.

## Remaining Steps

1. **Restart Outline** - After backend is running, restart Outline container to pick up OIDC config
2. **Test OIDC flow** - Verify the full login flow works:
   - Visit Outline at http://localhost:3010
   - Click "Login with SSO"
   - Redirects to backend OIDC authorize
   - User enters email for magic link
   - User clicks magic link
   - Redirect back to Outline with token
   - User is logged in
3. **Verify session persistence** - Confirm 365-day token works across browsers
4. **Add OIDC migration** - Generate a TypeORM migration for the three OIDC tables and flip `synchronize` back to `false`
5. **Deploy to production** - Update docker-compose.prod.yml with correct production OIDC settings

## File Locations

- OIDC Module: `/backend/src/oidc/`
- Docker Compose: `/infrastructure/docker-compose.dev.yml`
- Frontend browser launch: `/frontend/scripts/launch-browser-config.ts`

## Commands

```bash
# Start infrastructure
cd infrastructure && docker compose -f docker-compose.dev.yml up -d

# Start backend
cd backend && bun run dev

# Restart Outline to pick up OIDC config
docker restart cleancentive-outline
```
