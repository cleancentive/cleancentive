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
    const controller = new OidcController(oidcService as any, {} as any, integrationQueue as any);
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
    const controller = new OidcController(oidcService as any, {} as any, integrationQueue as any);

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
