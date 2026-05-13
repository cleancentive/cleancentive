import { S3Client } from '@aws-sdk/client-s3';

// The worker (worker/src/index.ts) constructs its own S3Client with the same shape —
// this monorepo has no shared workspace, so keep both in sync if env defaults change.
export function createS3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9002',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });
}
