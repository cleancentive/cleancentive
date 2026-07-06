import { afterEach, describe, expect, mock, test } from 'bun:test';

import { createBackblazeBucketCorsRules, updateBackblazeBucketCors } from './backblaze-b2';

afterEach(() => {
  mock.restore();
});

describe('createBackblazeBucketCorsRules', () => {
  test('creates a wiki upload cors rule for Backblaze native buckets', () => {
    expect(createBackblazeBucketCorsRules('https://wiki.cleancentive.org')).toEqual([
      {
        corsRuleName: 'uploadFromWikiOrigin',
        allowedOrigins: ['https://wiki.cleancentive.org'],
        allowedOperations: ['s3_head', 's3_get', 's3_put', 's3_post'],
        allowedHeaders: ['*'],
        exposeHeaders: ['ETag'],
        maxAgeSeconds: 3600,
      },
    ]);
  });

  test('updates the wiki bucket cors rules through the B2 native api', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/b2_authorize_account')) {
        return new Response(JSON.stringify({
          accountId: 'd2359c6e8ae9',
          apiUrl: 'https://api004.backblazeb2.com',
          authorizationToken: 'auth-token',
        }), { status: 200 });
      }
      if (url.endsWith('/b2_list_buckets')) {
        return new Response(JSON.stringify({
          buckets: [{ bucketId: 'dd827355b9fc368e98fa0e19', bucketName: 'cleancentive-wiki', bucketType: 'allPrivate' }],
        }), { status: 200 });
      }
      if (url.endsWith('/b2_update_bucket')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          accountId: 'd2359c6e8ae9',
          bucketId: 'dd827355b9fc368e98fa0e19',
          bucketType: 'allPrivate',
          corsRules: createBackblazeBucketCorsRules('https://wiki.cleancentive.org'),
        });
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await updateBackblazeBucketCors(
      { applicationKeyId: '004d2359c6e8ae90000000002', applicationKey: 'secret' },
      'cleancentive-wiki',
      'https://wiki.cleancentive.org',
    );

    globalThis.fetch = originalFetch;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
