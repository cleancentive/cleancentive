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

/**
 * Asks the storage endpoint the same CORS preflight the browser sends before a
 * wiki upload. Works on any S3-compatible provider, so it tells us whether CORS
 * actually needs fixing instead of assuming it does. An unreachable endpoint
 * counts as "not allowed" so the caller still reports the problem.
 */
export async function isUploadOriginAllowed(endpoint: string, bucketName: string, origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, '')}/${bucketName}/cors-preflight-probe`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
      signal: AbortSignal.timeout(5000),
    });
    const allowedOrigin = response.headers.get('access-control-allow-origin');
    return allowedOrigin === '*' || allowedOrigin === origin;
  } catch {
    return false;
  }
}
