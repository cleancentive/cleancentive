import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';

import { assertPublicHttpUrl, fetchHtml, fetchJson, RequestPacer } from './fetch-page';

function respond(body: string, contentType: string, extra: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': contentType, ...extra } })) as unknown as typeof fetch;
}

describe('assertPublicHttpUrl', () => {
  test('accepts a public https URL', () => {
    expect(assertPublicHttpUrl('https://cleanuptour.ch/participer/').hostname).toBe('cleanuptour.ch');
  });

  test('rejects a non-http scheme', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(BadRequestException);
  });

  test('rejects hosts inside our own network', () => {
    for (const url of ['http://localhost:3000/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://169.254.169.254/latest']) {
      expect(() => assertPublicHttpUrl(url)).toThrow(BadRequestException);
    }
  });

  test('rejects nonsense', () => {
    expect(() => assertPublicHttpUrl('not a url')).toThrow(BadRequestException);
  });
});

describe('fetchHtml', () => {
  test('returns the body of an HTML response', async () => {
    const html = await fetchHtml('https://example.org/p', respond('<p>hi</p>', 'text/html; charset=utf-8'));
    expect(html).toBe('<p>hi</p>');
  });

  test('refuses a response that is not HTML', async () => {
    await expect(fetchHtml('https://example.org/p', respond('{}', 'application/json'))).rejects.toThrow('expected text/html');
  });

  test('refuses a body over the size cap before decoding it', async () => {
    const huge = respond('<p>x</p>', 'text/html', { 'content-length': String(6 * 1024 * 1024) });
    await expect(fetchHtml('https://example.org/p', huge)).rejects.toThrow('over the');
  });

  test('refuses a non-2xx response', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchHtml('https://example.org/p', notFound)).rejects.toThrow('failed: 404');
  });
});

describe('fetchJson', () => {
  test('parses a JSON response and exposes its headers', async () => {
    const { body, headers } = await fetchJson<{ ok: boolean }>(
      'https://example.org/api',
      respond('{"ok":true}', 'application/json', { 'x-wp-total': '35' }),
    );
    expect(body.ok).toBe(true);
    expect(headers.get('x-wp-total')).toBe('35');
  });

  test('refuses an HTML error page served in place of JSON', async () => {
    await expect(fetchJson('https://example.org/api', respond('<html></html>', 'text/html'))).rejects.toThrow('expected JSON');
  });
});

describe('RequestPacer', () => {
  test('spaces calls out by the minimum interval', async () => {
    const slept: number[] = [];
    let clock = 1000;
    const pacer = new RequestPacer(
      1000,
      async (ms) => { slept.push(ms); clock += ms; },
      () => clock,
    );

    await pacer.wait();          // first call is immediate
    expect(slept).toEqual([]);

    await pacer.wait();          // second waits out the interval
    expect(slept).toEqual([1000]);

    clock += 5000;               // a slow request already covered the gap
    await pacer.wait();
    expect(slept).toEqual([1000]);
  });
});
