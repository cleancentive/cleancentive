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

const B2_NATIVE_CORS_OPERATIONS = ['s3_head', 's3_get', 's3_put', 's3_post'];

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
  }).then(assertOk);
}

async function authorizeB2(auth: B2Auth): Promise<{ accountId: string; apiUrl: string; authorizationToken: string }> {
  const apiUrl = auth.apiUrl ?? 'https://api.backblazeb2.com';
  const response = await fetch(`${apiUrl}/b2api/v3/b2_authorize_account`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${auth.applicationKeyId}:${auth.applicationKey}`).toString('base64')}`,
    },
  });
  await assertOk(response);
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
  await assertOk(response);
  const data = (await response.json()) as { buckets: B2Bucket[] };
  const bucket = data.buckets.find((candidate) => candidate.bucketName === bucketName);
  if (!bucket) throw new Error(`Bucket not found: ${bucketName}`);
  return bucket;
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw new Error(await response.text());
}
