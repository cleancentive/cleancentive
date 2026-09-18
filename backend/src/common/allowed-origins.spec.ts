import { describe, expect, test, afterEach } from 'bun:test';
import { allowedOrigins, isAllowedOrigin, resolveFrontendUrl } from './allowed-origins';

const saved = {
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  FRONTEND_URL: process.env.FRONTEND_URL,
  NODE_ENV: process.env.NODE_ENV,
};

function setEnv(env: Partial<Record<keyof typeof saved, string | undefined>>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => setEnv(saved));

describe('allowedOrigins', () => {
  test('prefers the CORS_ORIGINS list and trims trailing slashes', () => {
    setEnv({ CORS_ORIGINS: 'https://a.example/, https://b.example', FRONTEND_URL: 'https://c.example' });
    expect(allowedOrigins()).toEqual(['https://a.example', 'https://b.example']);
  });

  test('falls back to FRONTEND_URL when no list is configured', () => {
    setEnv({ CORS_ORIGINS: '', FRONTEND_URL: 'https://c.example' });
    expect(allowedOrigins()).toEqual(['https://c.example']);
  });

  test('refuses to run unconfigured outside dev and test', () => {
    setEnv({ CORS_ORIGINS: '', FRONTEND_URL: '', NODE_ENV: 'production' });
    expect(() => allowedOrigins()).toThrow(/No allowed origins configured/);
  });

  test('has a dev fallback so a fresh clone starts', () => {
    setEnv({ CORS_ORIGINS: '', FRONTEND_URL: '', NODE_ENV: 'development' });
    expect(allowedOrigins()).toEqual(['https://cleancentive.local']);
  });
});

describe('resolveFrontendUrl', () => {
  test('keeps an allowlisted origin', () => {
    setEnv({ CORS_ORIGINS: 'https://a.example,https://b.example' });
    expect(resolveFrontendUrl('https://b.example')).toBe('https://b.example');
  });

  test('ignores an attacker-supplied origin so magic links stay on our host', () => {
    setEnv({ CORS_ORIGINS: 'https://a.example' });
    expect(resolveFrontendUrl('https://evil.example')).toBe('https://a.example');
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });

  test('falls back when the request carried no origin at all', () => {
    setEnv({ CORS_ORIGINS: 'https://a.example' });
    expect(resolveFrontendUrl(undefined)).toBe('https://a.example');
  });
});
