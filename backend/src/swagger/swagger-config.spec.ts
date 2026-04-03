import { describe, expect, test } from 'bun:test';

import { buildSwaggerCustomJs, swaggerJsonPath, swaggerUiPath } from './swagger-config';

describe('swagger-config', () => {
  test('mounts Swagger UI at /api', () => {
    expect(swaggerUiPath).toBe('api');
    expect(swaggerJsonPath).toBe('api/openapi.json');
  });

  test('bootstraps Swagger auth from the frontend auth store', () => {
    const script = buildSwaggerCustomJs();

    expect(script).toContain("var frontendAuthStorageKey = 'auth-storage';");
    expect(script).toContain('persistedState.sessionToken');
    expect(script).toContain('getAuthorizedToken(ui) || localStorage.getItem(storageKey) || getFrontendSessionToken()');
    expect(script).toContain("window.location.origin + '/api/v1' + path");
  });
});
