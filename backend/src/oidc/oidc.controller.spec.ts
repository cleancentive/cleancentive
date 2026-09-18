import { describe, expect, test } from 'bun:test';

import { OidcController } from './oidc.controller';

describe('OidcController token exchange integration hooks', () => {
  test('enqueues Outline bootstrap after successful authorization-code exchange', async () => {
    const enqueued: unknown[] = [];
    const oidcService = {
      getClientSecret: async () => 'secret',
      validateAuthorizationCode: async () => ({ userId: 'user-1', scope: 'openid profile email', nonce: 'nonce-1' }),
      exchangeCodeForTokens: async () => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        tokenType: 'Bearer',
        expiresIn: 1800,
      }),
    };
    const integrationQueue = {
      enqueueOutlineBootstrap: async (payload: unknown) => enqueued.push(payload),
    };
    const controller = new OidcController(oidcService as any, integrationQueue as any);
    const response = jsonResponse();

    await controller.token({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://wiki.cleancentive.org/auth/oidc.callback',
      client_id: 'outline',
      client_secret: 'secret',
    }, response as any);

    expect(enqueued).toEqual([{ userId: 'user-1' }]);
    expect(response.body).toMatchObject({ access_token: 'access-token', id_token: 'id-token' });
  });

  test('does not enqueue Outline bootstrap for other clients', async () => {
    const enqueued: unknown[] = [];
    const oidcService = {
      getClientSecret: async () => 'secret',
      validateAuthorizationCode: async () => ({ userId: 'user-1', scope: 'openid profile email', nonce: 'nonce-1' }),
      exchangeCodeForTokens: async () => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        tokenType: 'Bearer',
        expiresIn: 1800,
      }),
    };
    const integrationQueue = {
      enqueueOutlineBootstrap: async (payload: unknown) => enqueued.push(payload),
    };
    const controller = new OidcController(oidcService as any, integrationQueue as any);

    await controller.token({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://example.test/callback',
      client_id: 'other',
      client_secret: 'secret',
    }, jsonResponse() as any);

    expect(enqueued).toEqual([]);
  });
});

function jsonResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe('OidcController authorize', () => {
  test('refuses an unregistered redirect_uri instead of bouncing to it', async () => {
    const oidcService = {
      getClient: async () => ({ clientId: 'outline' }),
      validateRedirectUri: async () => false,
    };
    const controller = new OidcController(oidcService as any, {} as any);
    const res = { redirect: (url: string) => redirects.push(url) };
    const redirects: string[] = [];

    // An open redirect wearing our domain: the error response used to go to
    // whatever redirect_uri the caller named, before anything was validated.
    await expect(
      controller.authorize(
        { url: '/authorize' } as any,
        res as any,
        'token',
        'outline',
        'https://evil.example',
        'openid',
        'state-1',
      ),
    ).rejects.toThrow('Invalid redirect URI');
    expect(redirects).toEqual([]);
  });

  test('refuses an unknown client before looking at anything else', async () => {
    const oidcService = {
      getClient: async () => null,
      validateRedirectUri: async () => false,
    };
    const controller = new OidcController(oidcService as any, {} as any);
    const redirects: string[] = [];
    const res = { redirect: (url: string) => redirects.push(url) };

    await expect(
      controller.authorize(
        { url: '/authorize' } as any,
        res as any,
        'code',
        'not-a-client',
        'https://evil.example',
        'openid',
        'state-1',
      ),
    ).rejects.toThrow('Unknown client');
    expect(redirects).toEqual([]);
  });
});

describe('OidcController token', () => {
  test('rejects a wrong client secret', async () => {
    const oidcService = { getClientSecret: async () => 'the-real-secret' };
    const controller = new OidcController(oidcService as any, {} as any);
    const response = jsonResponse();

    await controller.token(
      { grant_type: 'authorization_code', client_id: 'outline', client_secret: 'wrong' },
      response as any,
    );

    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({ error: 'invalid_client' });
  });

  test('rejects a secret that is merely a prefix of the real one', async () => {
    const oidcService = { getClientSecret: async () => 'the-real-secret' };
    const controller = new OidcController(oidcService as any, {} as any);
    const response = jsonResponse();

    await controller.token(
      { grant_type: 'authorization_code', client_id: 'outline', client_secret: 'the-real' },
      response as any,
    );

    expect(response.statusCode).toBe(401);
  });
});
