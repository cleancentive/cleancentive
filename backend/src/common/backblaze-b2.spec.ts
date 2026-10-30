import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
  BackblazeApiError,
  createBackblazeBucketCorsRules,
  describeBackblazeCorsFailure,
  getBackblazeApiUrl,
  isBackblazeEndpoint,
  updateBackblazeBucketCors,
} from './backblaze-b2';

afterEach(() => {
  mock.restore();
});

describe('createBackblazeBucketCorsRules', () => {
  test('uses the explicit B2 api host when provided', () => {
    expect(getBackblazeApiUrl({ OUTLINE_B2_API_URL: 'https://api004.backblazeb2.com' } as NodeJS.ProcessEnv)).toBe(
      'https://api004.backblazeb2.com',
    );
  });

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

describe('isBackblazeEndpoint', () => {
  test('rejects the MinIO endpoint dev runs against', () => {
    expect(isBackblazeEndpoint('http://localhost:9002')).toBe(false);
  });

  test('accepts Backblaze S3 and native api hosts', () => {
    expect(isBackblazeEndpoint('https://s3.us-west-004.backblazeb2.com')).toBe(true);
    expect(isBackblazeEndpoint('https://api004.backblazeb2.com')).toBe(true);
  });

  test('rejects look-alike hosts and unparseable endpoints', () => {
    expect(isBackblazeEndpoint('https://notbackblazeb2.com')).toBe(false);
    expect(isBackblazeEndpoint('')).toBe(false);
  });
});

describe('describeBackblazeCorsFailure', () => {
  test('names the credential env vars when Backblaze rejects the key', () => {
    const message = describeBackblazeCorsFailure(
      new BackblazeApiError('authorize', 401, 'bad_auth_token'),
      'cleancentive-wiki',
      'https://wiki.cleancentive.org',
    );

    expect(message).toContain('401 bad_auth_token');
    expect(message).toContain('OUTLINE_S3_ACCESS_KEY');
    expect(message).toContain('OUTLINE_S3_SECRET_KEY');
    expect(message).not.toContain('writeBucketCors');
  });

  test('names the listBuckets capability when the key cannot enumerate buckets', () => {
    const message = describeBackblazeCorsFailure(
      new BackblazeApiError('listBuckets', 401, 'unauthorized'),
      'cleancentive-wiki',
      'https://wiki.cleancentive.org',
    );

    expect(message).toContain('listBuckets');
  });

  test('names writeBucketCors and the manual console steps when the update is refused', () => {
    const message = describeBackblazeCorsFailure(
      new BackblazeApiError('updateBucket', 401, 'unauthorized'),
      'cleancentive-wiki',
      'https://wiki.cleancentive.org',
    );

    expect(message).toContain('writeBucketCors');
    expect(message).toContain('CORS Rules');
    expect(message).toContain('s3_head/s3_get/s3_put/s3_post');
  });
});

describe('updateBackblazeBucketCors error reporting', () => {
  test('reports which call failed instead of surfacing the raw B2 error body', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: 'bad_auth_token', message: '', status: 401 }), {
        status: 401,
      })) as unknown as typeof fetch;

    const error = await updateBackblazeBucketCors(
      { applicationKeyId: 'minioadmin', applicationKey: 'minioadmin' },
      'cleancentive-wiki',
      'https://wiki.cleancentive.local',
    ).catch((e) => e);

    globalThis.fetch = originalFetch;

    expect(error).toBeInstanceOf(BackblazeApiError);
    expect(error.stage).toBe('authorize');
    expect(error.status).toBe(401);
    expect(error.code).toBe('bad_auth_token');
  });
});
