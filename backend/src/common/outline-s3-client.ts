export function getOutlineS3ClientConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    region: env.OUTLINE_S3_REGION ?? env.S3_REGION ?? 'us-east-1',
    endpoint: env.OUTLINE_S3_ENDPOINT ?? env.S3_ENDPOINT ?? 'http://localhost:9002',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.OUTLINE_S3_ACCESS_KEY ?? env.S3_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: env.OUTLINE_S3_SECRET_KEY ?? env.S3_SECRET_KEY ?? 'minioadmin',
    },
  };
}
