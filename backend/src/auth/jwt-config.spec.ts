import { describe, expect, test, afterEach } from 'bun:test';
import { getJwtSecret } from './jwt-config';

const saved = { JWT_SECRET: process.env.JWT_SECRET, NODE_ENV: process.env.NODE_ENV };

function setEnv(env: Partial<Record<keyof typeof saved, string | undefined>>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => setEnv(saved));

describe('getJwtSecret', () => {
  test('refuses to start with no secret rather than signing with a published default', () => {
    setEnv({ NODE_ENV: 'production', JWT_SECRET: undefined });
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
  });

  test('refuses the placeholder shipped in .env.example', () => {
    setEnv({ NODE_ENV: 'production', JWT_SECRET: 'your-secret-key-change-in-production' });
    expect(() => getJwtSecret()).toThrow(/well-known placeholder/);
  });

  test('refuses the fallback that used to be hard-coded in the source', () => {
    setEnv({ NODE_ENV: 'production', JWT_SECRET: 'default-secret-change-in-production' });
    expect(() => getJwtSecret()).toThrow(/well-known placeholder/);
  });

  test('accepts a real secret', () => {
    setEnv({ NODE_ENV: 'production', JWT_SECRET: 'CQ0M8hb3pOaHo2rTS4vGZk1XxLbnUeWq' });
    expect(getJwtSecret()).toBe('CQ0M8hb3pOaHo2rTS4vGZk1XxLbnUeWq');
  });

  test('tests run without one so specs need no environment setup', () => {
    setEnv({ NODE_ENV: 'test', JWT_SECRET: undefined });
    expect(getJwtSecret()).toBe('test-only-secret');
  });
});
