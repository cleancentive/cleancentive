import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

/**
 * Default-deny inventory: every HTTP route either carries a guard, or is listed
 * here as deliberately public. Adding a controller method without a guard fails
 * this test until someone writes the route down as public on purpose.
 *
 * Five unauthenticated routes on UserController (`GET /user/:id`,
 * `POST /user/:id/register`, `POST|GET /user/:id/emails/*`,
 * `PUT /user/:id/profile`) let anyone attach an email to any account and then
 * request a magic link for it — account takeover, including of stewards. They
 * were removed; this test is what stops them coming back.
 */
const PUBLIC_ROUTES = new Set([
  // Sign-in and account recovery: the credential is the emailed link itself.
  'POST /auth/magic-link',
  'GET /auth/verify',
  'POST /auth/guest',
  'GET /auth/pending/:requestId',
  'GET /auth/verify-email',
  'GET /auth/merge-confirm',
  'POST /auth/recover',
  'POST /auth/last-seen',
  'POST /auth/logout',
  // Device-code flow: the code is the credential, approval is guarded.
  'POST /auth/device-code',
  'GET /auth/device-code/:id',
  // Public read surface — the map, spot pages and shared links.
  'GET /user/:id/avatar',
  'GET /spots/:id/view',
  'GET /spots/:id/edit-history',
  'GET /spots/:id/thumbnail',
  'GET /labels',
  'GET /calendar/:userId/joined.ics',
  'GET /calendar/:userId/discover.ics',
  'GET /calendar/cleanup-dates/:id.ics',
  // Version + uptime probes.
  'GET /version',
  'GET /health/detection',
  // OIDC provider surface: authenticated by client secret, PKCE or the code itself.
  'GET /oidc/.well-known/openid-configuration',
  'GET /oidc/.well-known/jwks.json',
  'GET /oidc/authorize',
  'POST /oidc/token',
  'POST /oidc/revoke',
  // Authenticated by HMAC signature over the raw body.
  'POST /outline-webhooks/incoming',
]);

/**
 * The last routes with no credential of their own. Each is fixed by a later
 * commit in the same series; this list must only ever shrink.
 */
const PENDING_HARDENING = new Set([
  'GET /insights/map',
  'GET /insights/stats',
  'GET /oidc/callback',
  'POST /auth/device-code/reject',
]);

function listControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listControllerFiles(full));
    } else if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Route {
  key: string;
  controller: string;
  guards: string[];
}

async function collectRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of listControllerFiles(join(import.meta.dir, '..'))) {
    const mod = await import(file);
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const controller = exported as new (...args: unknown[]) => unknown;
      const basePath = Reflect.getMetadata(PATH_METADATA, controller);
      if (basePath === undefined) continue;

      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      const proto = controller.prototype;

      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = Object.getOwnPropertyDescriptor(proto, name)?.value;
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;

        const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        const guards = [...classGuards, ...methodGuards]
          .map((g: any) => (typeof g === 'function' ? g.name : String(g)));

        const path = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const full = `/${[basePath, path].filter((p) => p && p !== '/').join('/')}`;
        routes.push({
          key: `${RequestMethod[method]} ${full}`,
          controller: controller.name,
          guards,
        });
      }
    }
  }
  return routes;
}

describe('every HTTP route is guarded or explicitly public', () => {
  test('no route is silently unauthenticated', async () => {
    const routes = await collectRoutes();
    expect(routes.length).toBeGreaterThan(50);

    const unguarded = routes
      .filter(
        (r) =>
          r.guards.length === 0 &&
          !PUBLIC_ROUTES.has(r.key) &&
          !PENDING_HARDENING.has(r.key),
      )
      .map((r) => `${r.key} (${r.controller})`)
      .sort();

    expect(unguarded).toEqual([]);
  });

  test('the public allowlist has no stale entries', async () => {
    const routes = await collectRoutes();
    const known = new Set(routes.map((r) => r.key));
    const stale = [...PUBLIC_ROUTES, ...PENDING_HARDENING]
      .filter((key) => !known.has(key))
      .sort();

    expect(stale).toEqual([]);
  });
});
