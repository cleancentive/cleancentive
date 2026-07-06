import { describe, expect, test } from 'bun:test';

import { getOutlineS3ClientConfig } from './outline-s3-client';

describe('getOutlineS3ClientConfig', () => {
  test('prefers dedicated wiki S3 env vars over shared app S3 vars', () => {
    const config = getOutlineS3ClientConfig({
      OUTLINE_S3_REGION: 'us-west-004',
      OUTLINE_S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
      OUTLINE_S3_ACCESS_KEY: 'wiki-access',
      OUTLINE_S3_SECRET_KEY: 'wiki-secret',
      S3_REGION: 'us-east-1',
      S3_ENDPOINT: 'http://localhost:9002',
      S3_ACCESS_KEY: 'shared-access',
      S3_SECRET_KEY: 'shared-secret',
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      region: 'us-west-004',
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'wiki-access',
        secretAccessKey: 'wiki-secret',
      },
    });
  });
});
