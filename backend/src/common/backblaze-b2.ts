type B2Auth = {
  applicationKeyId: string;
  applicationKey: string;
  apiUrl?: string;
};

type B2Bucket = {
  bucketId: string;
  bucketName: string;
  bucketType: 'allPrivate' | 'allPublic';
  corsRules?: Array<{
    corsRuleName: string;
    allowedOrigins: string[];
    allowedOperations: string[];
    allowedHeaders: string[];
    exposeHeaders: string[];
    maxAgeSeconds: number;
  }>;
};

type B2CallStage = 'authorize' | 'listBuckets' | 'updateBucket';

const B2_NATIVE_CORS_OPERATIONS = ['s3_head', 's3_get', 's3_put', 's3_post'];

/**
 * Raised when the B2 native API answers with an error. Carries the stage and
 * error code so callers can turn "401 bad_auth_token" into an instruction that
 * names the credential or capability that is actually missing.
 */
export class BackblazeApiError extends Error {
  constructor(
    readonly stage: B2CallStage,
    readonly status: number,
    readonly code: string,
  ) {
    super(`Backblaze ${stage} failed (${status} ${code || 'no error code'})`);
    this.name = 'BackblazeApiError';
  }
}

export function getBackblazeApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.OUTLINE_B2_API_URL ?? env.B2_API_URL ?? 'https://api004.backblazeb2.com';
}

/**
 * Whether the configured object storage is Backblaze B2. Dev runs against
 * MinIO, which has no B2 native API, so the B2 CORS call must never fire there.
 */
export function isBackblazeEndpoint(endpoint: string): boolean {
  try {
    const { hostname } = new URL(endpoint);
    return hostname === 'backblazeb2.com' || hostname.endsWith('.backblazeb2.com');
  } catch {
    return false;
  }
}

export function createBackblazeBucketCorsRules(origin: string) {
  return [
    {
      corsRuleName: 'uploadFromWikiOrigin',
      allowedOrigins: [origin],
      allowedOperations: B2_NATIVE_CORS_OPERATIONS,
      allowedHeaders: ['*'],
      exposeHeaders: ['ETag'],
      maxAgeSeconds: 3600,
    },
  ];
}

/**
 * Turns a failed CORS provisioning attempt into a message that says which knob
 * to turn. Every branch names the env var or console screen that fixes it.
 */
export function describeBackblazeCorsFailure(error: unknown, bucketName: string, origin: string): string {
  const problem = `Wiki uploads from ${origin} will fail: Backblaze bucket "${bucketName}" has no CORS rule for that origin and it could not be set automatically.`;
  const manualFix =
    `You can also add it by hand: B2 console -> Buckets -> "${bucketName}" -> CORS Rules -> allow ${origin} for ` +
    `${B2_NATIVE_CORS_OPERATIONS.join('/')}.`;

  if (!(error instanceof BackblazeApiError)) {
    return `${problem} ${error instanceof Error ? error.message : String(error)}. ${manualFix}`;
  }

  if (error.stage === 'authorize') {
    return (
      `${problem} Backblaze rejected the credentials (${error.status} ${error.code || 'no error code'}). ` +
      `OUTLINE_S3_ACCESS_KEY and OUTLINE_S3_SECRET_KEY must be a Backblaze application key pair (keyID and applicationKey from the B2 console).`
    );
  }

  if (error.stage === 'listBuckets') {
    return (
      `${problem} The application key may not list buckets (${error.status} ${error.code || 'no error code'}). ` +
      `Give the key the listBuckets capability, or scope it to "${bucketName}".`
    );
  }

  return (
    `${problem} The application key is missing the writeBucketCors capability (${error.status} ${error.code || 'no error code'}). ` +
    `Create a key with writeBucketCors and listBuckets in the B2 console, then update OUTLINE_S3_ACCESS_KEY and OUTLINE_S3_SECRET_KEY. ${manualFix}`
  );
}

export async function updateBackblazeBucketCors(auth: B2Auth, bucketName: string, origin: string): Promise<void> {
  const account = await authorizeB2(auth);
  const bucket = await getBucket(account.apiUrl, account.authorizationToken, account.accountId, bucketName);

  await fetch(`${account.apiUrl}/b2api/v3/b2_update_bucket`, {
    method: 'POST',
    headers: {
      Authorization: account.authorizationToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId: account.accountId,
      bucketId: bucket.bucketId,
      bucketType: bucket.bucketType,
      corsRules: createBackblazeBucketCorsRules(origin),
    }),
  }).then((response) => assertOk(response, 'updateBucket'));
}

async function authorizeB2(auth: B2Auth): Promise<{ accountId: string; apiUrl: string; authorizationToken: string }> {
  const apiUrl = auth.apiUrl ?? getBackblazeApiUrl();
  const response = await fetch(`${apiUrl}/b2api/v3/b2_authorize_account`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${auth.applicationKeyId}:${auth.applicationKey}`).toString('base64')}`,
    },
  });
  await assertOk(response, 'authorize');
  const data = (await response.json()) as {
    accountId: string;
    apiUrl?: string;
    apiInfo?: { apiUrl?: string };
    authorizationToken: string;
  };
  return {
    accountId: data.accountId,
    apiUrl: data.apiUrl ?? data.apiInfo?.apiUrl ?? apiUrl,
    authorizationToken: data.authorizationToken,
  };
}

async function getBucket(apiUrl: string, authorizationToken: string, accountId: string, bucketName: string): Promise<B2Bucket> {
  const response = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets`, {
    method: 'POST',
    headers: {
      Authorization: authorizationToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountId }),
  });
  await assertOk(response, 'listBuckets');
  const data = (await response.json()) as { buckets: B2Bucket[] };
  const bucket = data.buckets.find((candidate) => candidate.bucketName === bucketName);
  if (!bucket) throw new Error(`No bucket named "${bucketName}" in this Backblaze account (check OUTLINE_S3_BUCKET)`);
  return bucket;
}

async function assertOk(response: Response, stage: B2CallStage): Promise<void> {
  if (response.ok) return;
  throw new BackblazeApiError(stage, response.status, await readErrorCode(response));
}

async function readErrorCode(response: Response): Promise<string> {
  const body = await response.text();
  try {
    return (JSON.parse(body) as { code?: string }).code ?? '';
  } catch {
    return body.slice(0, 200);
  }
}
