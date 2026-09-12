import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { Pool, PoolClient } from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { hostname } from 'os';
import sharp from 'sharp';
import { clampWeightGrams } from '@cleancentive/shared';
import type { LitterDetectionJobData, DetectedObject, DetectionResult } from '@cleancentive/shared';
import { persistDetection as persistDetectionToDb } from './detection';
import { buildUsageRow, recordLlmUsage } from './llm-usage';
import type { CompletionUsage } from './llm-usage';
import {
  buildDetectionProviders,
  describeProviderError,
  isEntitlementWall,
  shouldTryNextProvider,
} from './detection-providers';
import type { DetectionProvider } from './detection-providers';
import { PlantNetIdentifier } from './identifiers/plantnet';
import { MistralPlantIdentifier } from './identifiers/mistral-plant';
import { ShadowPlantIdentifier } from './identifiers/shadow';
import type { PlantIdentifier } from './identifiers/types';
import { persistPlantIdentification } from './plant-identification';

interface SpotJobData extends LitterDetectionJobData {
  subjectKind?: 'litter' | 'plant';
}

interface WorkerOpsState {
  name: string;
  lastHeartbeatAt?: string;
  lastJobStartedAt?: string;
  lastJobCompletedAt?: string;
  lastJobFailedAt?: string;
  lastFailedError?: string | null;
  concurrency: number;
  hostname: string;
  pid: number;
  commit: string;
  commitShort: string;
  buildTime: number;
}

const pkg = require('../package.json');

const queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
const bucketName = process.env.S3_BUCKET || 'cleancentive-images';
const detectionMaxImageSize = parseInt(process.env.DETECTION_MAX_IMAGE_SIZE || '1024', 10);
const workerConcurrency = parseInt(process.env.DETECTION_CONCURRENCY || '2', 10);
const workerOpsKey = `ops:worker:${queueName}`;
const workerHeartbeatIntervalMs = 10_000;
const workerHeartbeatTtlSeconds = 30;

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

const redisClient = new Redis(redisConnection);

const dbPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME || 'cleancentive',
  password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
  database: process.env.DB_DATABASE || 'cleancentive',
});

const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9002',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
});

// Primary first, then any configured fallbacks. A detection walks this chain on
// provider-side failures so one provider losing its entitlement cannot take
// detection down on its own.
const detectionProviders = buildDetectionProviders();
const primaryProvider = detectionProviders[0] ?? null;

const plantNetApiKey = process.env.PLANTNET_API_KEY;
const plantNetBaseUrl = process.env.PLANTNET_BASE_URL || 'https://my-api.plantnet.org/v2';
const plantNetProject = process.env.PLANTNET_PROJECT || 'weurope';
const plantNetMinConfidence = parseFloat(process.env.PLANTNET_MIN_CONFIDENCE || '0.6');
const plantIdentifierMode = process.env.PLANT_IDENTIFIER || 'plantnet';

function buildPlantIdentifier(): PlantIdentifier | null {
  const plantnet = plantNetApiKey
    ? new PlantNetIdentifier(plantNetApiKey, plantNetBaseUrl, plantNetProject, plantNetMinConfidence)
    : null;
  const mistral = primaryProvider ? new MistralPlantIdentifier(primaryProvider.client, primaryProvider.model) : null;

  if (plantIdentifierMode === 'mistral') return mistral;
  if (plantIdentifierMode === 'shadow:plantnet+mistral') {
    if (plantnet && mistral) return new ShadowPlantIdentifier(plantnet, mistral);
    return plantnet ?? mistral;
  }
  return plantnet;
}

const plantIdentifier = buildPlantIdentifier();

interface LabelTaxonomy {
  objects: string[];
  materials: string[];
  brands: string[];
}

// The worker mints a label from any new string a model returns, so this list only
// ever grows — brands worst of all. Keeping the top N by actual usage bounds the
// prompt and is a stronger signal than a long tail of one-off inventions.
const taxonomyLimits = {
  object: parseInt(process.env.DETECTION_MAX_OBJECT_LABELS || '100', 10),
  material: parseInt(process.env.DETECTION_MAX_MATERIAL_LABELS || '40', 10),
  brand: parseInt(process.env.DETECTION_MAX_BRAND_LABELS || '150', 10),
};

// Rebuilding the prompt per job cost a DB round-trip per detection and, worse,
// changed the cached prefix whenever a label was created — which happens most
// often during a burst, exactly when caching would pay off. Learning still
// happens; it just lands at the next refresh instead of the next job.
const taxonomyTtlMs = parseInt(process.env.DETECTION_TAXONOMY_TTL_MS || '600000', 10);
let cachedPrompt: { value: string; expiresAt: number } | null = null;

async function fetchLabelTaxonomy(): Promise<LabelTaxonomy> {
  const rows = await dbPool.query<{ type: string; name: string }>(
    `WITH usage AS (
       SELECT object_label_id AS label_id FROM detected_items WHERE object_label_id IS NOT NULL
       UNION ALL
       SELECT material_label_id FROM detected_items WHERE material_label_id IS NOT NULL
       UNION ALL
       SELECT brand_label_id FROM detected_items WHERE brand_label_id IS NOT NULL
     ),
     counts AS (
       SELECT label_id, COUNT(*) AS n FROM usage GROUP BY label_id
     ),
     ranked AS (
       SELECT l.type,
              lt.name,
              ROW_NUMBER() OVER (
                PARTITION BY l.type
                ORDER BY COALESCE(c.n, 0) DESC, lt.name ASC
              ) AS rn
       FROM labels l
       JOIN label_translations lt ON lt.label_id = l.id
       LEFT JOIN counts c ON c.label_id = l.id
       WHERE lt.locale = 'en'
     )
     SELECT type, name
     FROM ranked
     WHERE rn <= CASE type
                   WHEN 'object' THEN $1::int
                   WHEN 'material' THEN $2::int
                   WHEN 'brand' THEN $3::int
                   ELSE 0
                 END
     -- Alphabetical, not by rank: usage counts shift with every detection, and a
     -- prefix that reshuffles on its own would never cache.
     ORDER BY type, name`,
    [taxonomyLimits.object, taxonomyLimits.material, taxonomyLimits.brand],
  );

  const taxonomy: LabelTaxonomy = { objects: [], materials: [], brands: [] };
  for (const row of rows.rows) {
    if (row.type === 'object') taxonomy.objects.push(row.name);
    else if (row.type === 'material') taxonomy.materials.push(row.name);
    else if (row.type === 'brand') taxonomy.brands.push(row.name);
  }
  return taxonomy;
}

async function getSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (cachedPrompt && cachedPrompt.expiresAt > now) {
    return cachedPrompt.value;
  }

  const value = buildSystemPrompt(await fetchLabelTaxonomy());
  cachedPrompt = { value, expiresAt: now + taxonomyTtlMs };
  return value;
}

function buildSystemPrompt(taxonomy: LabelTaxonomy): string {
  const objectsList = taxonomy.objects.join(', ') || '(none yet)';
  const materialsList = taxonomy.materials.join(', ') || '(none yet)';
  const brandsList = taxonomy.brands.join(', ') || '(none yet)';

  return `You detect litter in photos and return JSON only.
Return this shape:
{
  "objects": [
    {
      "category": "string or null",
      "material": "string or null",
      "brand": "string or null",
      "weightGrams": 12.3,
      "confidence": 0.91
    }
  ],
  "notes": "optional string or null"
}

Known labels (use these exact names when they match; if reality requires a new term, use Title Case):
Objects: ${objectsList}
Materials: ${materialsList}
Brands: ${brandsList}

Rules:
- Be conservative and only return visible litter items.
- category should be a single object type (e.g. "Bottle", not "plastic bottle"). Use material for the material.
- material should be a single material (e.g. "Plastic", not "plastic and tobacco").
- brand should be a recognized product brand name, or null if not identifiable. Do not use generic product names as brands.
- Use Title Case for all category, material, and brand values.
- category/material/brand may be null if uncertain.
- weightGrams should be estimated as a number in grams when possible.
- confidence is a number in [0,1].`;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function normalizeConfidence(value: unknown): number | null {
  const numeric = asOptionalNumber(value);
  if (numeric === null) {
    return null;
  }

  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function normalizeObjects(rawObjects: unknown): DetectedObject[] {
  if (!Array.isArray(rawObjects)) {
    return [];
  }

  return rawObjects
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return null;
      }

      const value = candidate as Record<string, unknown>;

      return {
        category: asOptionalString(value.category),
        material: asOptionalString(value.material),
        brand: asOptionalString(value.brand),
        weightGrams: clampWeightGrams(asOptionalNumber(value.weightGrams)),
        confidence: normalizeConfidence(value.confidence),
      };
    })
    .filter((value): value is DetectedObject => value !== null);
}

function nowIsoString(): string {
  return new Date().toISOString();
}

async function writeWorkerState(patch: Partial<WorkerOpsState>): Promise<void> {
  let current: Partial<WorkerOpsState> = {};

  try {
    const existing = await redisClient.get(workerOpsKey);
    if (existing) {
      current = JSON.parse(existing) as Partial<WorkerOpsState>;
    }
  } catch {
    current = {};
  }

  const nextState: WorkerOpsState = {
    ...current,
    ...patch,
    // Identity fields must reflect the running process — never inherit from stale Redis state left behind by a previous worker version.
    name: queueName,
    concurrency: workerConcurrency,
    hostname: hostname(),
    pid: process.pid,
    commit: pkg.commit || 'dev',
    commitShort: pkg.commitShort || 'dev',
    buildTime: pkg.buildTime ?? 0,
  };

  await redisClient.set(workerOpsKey, JSON.stringify(nextState), 'EX', workerHeartbeatTtlSeconds);
}

async function publishHeartbeat(): Promise<void> {
  await writeWorkerState({ lastHeartbeatAt: nowIsoString() });
}

async function fetchImageBytes(imageKey: string): Promise<Uint8Array> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: imageKey,
    }),
  );

  if (!response.Body) {
    throw new Error('Image object has no response body');
  }

  if ('transformToByteArray' in response.Body) {
    return response.Body.transformToByteArray();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array | Buffer | string>) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }

  return new Uint8Array(Buffer.concat(chunks));
}

async function resizeForDetection(imageBytes: Uint8Array, maxDimension: number): Promise<Uint8Array> {
  const image = sharp(imageBytes);
  const metadata = await image.metadata();

  if (metadata.width && metadata.height &&
      metadata.width <= maxDimension && metadata.height <= maxDimension) {
    return imageBytes;
  }

  return image
    .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function detectLitter(
  imageBytes: Uint8Array,
  mimeType: string,
  systemPrompt: string,
): Promise<{ detection: DetectionResult; model: string; provider: DetectionProvider; usage: CompletionUsage | undefined }> {
  if (detectionProviders.length === 0) {
    throw new Error('No detection provider is configured for the worker (set DETECTION_API_KEY and DETECTION_MODEL)');
  }

  const dataUrl = `data:${mimeType};base64,${Buffer.from(imageBytes).toString('base64')}`;
  const failures: string[] = [];

  for (const provider of detectionProviders) {
    let content: string | null | undefined;
    let usage: CompletionUsage | undefined;

    try {
      const completion = await provider.client.chat.completions.create({
        model: provider.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Detect litter items in this photo and return the results.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      });

      content = completion.choices[0]?.message?.content;
      usage = completion.usage;
    } catch (error) {
      const description = describeProviderError(provider, error);

      if (!shouldTryNextProvider(error)) {
        // Our request was bad, not the provider — every provider would reject it
        // the same way, so walking the rest of the chain only wastes calls.
        throw new Error(description);
      }

      console.error(isEntitlementWall(error) ? `DETECTION ENTITLEMENT: ${description}` : description);
      failures.push(description);
      continue;
    }

    if (!content) {
      const description = `${provider.label} (${provider.model}) returned an empty response`;
      console.error(description);
      failures.push(description);
      continue;
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;

    return {
      detection: {
        objects: normalizeObjects(parsed.objects),
        notes: asOptionalString(parsed.notes),
      },
      model: provider.model,
      provider,
      usage,
    };
  }

  throw new Error(`All ${detectionProviders.length} detection provider(s) failed: ${failures.join(' | ')}`);
}

async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markSpotProcessing(spotId: string, userId: string): Promise<void> {
  await dbPool.query(
    `
      UPDATE spots
      SET processing_status = 'processing',
          detection_started_at = NOW(),
          processing_error = NULL,
          updated_at = NOW(),
          updated_by = $2
      WHERE id = $1
    `,
    [spotId, userId],
  );
}

async function markSpotFailed(spotId: string, userId: string, errorMessage: string): Promise<void> {
  const truncatedError = errorMessage.slice(0, 4000);

  await dbPool.query(
    `
      UPDATE spots
      SET processing_status = 'failed',
          processing_error = $3,
          updated_at = NOW(),
          updated_by = $2
      WHERE id = $1
    `,
    [spotId, userId, truncatedError],
  );
}

async function persistDetection(
  spotId: string,
  userId: string,
  detection: DetectionResult,
  model: string,
): Promise<void> {
  await withTransaction((client) => persistDetectionToDb(client, spotId, userId, detection, model));
}

async function runLitterDetection(spotId: string, userId: string, imageKey: string): Promise<{ count: number }> {
  const systemPrompt = await getSystemPrompt();

  const imageBytes = await fetchImageBytes(imageKey);
  const resizedBytes = await resizeForDetection(imageBytes, detectionMaxImageSize);
  // Record the model that actually served this detection, not the one we asked
  // first — otherwise a fallback silently files its results under the primary.
  const { detection, model, provider, usage } = await detectLitter(resizedBytes, 'image/jpeg', systemPrompt);
  await persistDetection(spotId, userId, detection, model);
  await recordLlmUsage(
    dbPool,
    buildUsageRow({
      spotId,
      purpose: 'litter-detection',
      providerLabel: provider.label,
      providerHost: provider.host,
      model,
      usage,
    }),
  );
  return { count: detection.objects.length };
}

async function runPlantIdentification(spotId: string, userId: string, imageKey: string): Promise<{ scientificName: string | null }> {
  if (!plantIdentifier) {
    throw new Error('Plant identifier is not configured (set PLANTNET_API_KEY or PLANT_IDENTIFIER=mistral with DETECTION_API_KEY)');
  }

  const imageBytes = await fetchImageBytes(imageKey);
  const resizedBytes = await resizeForDetection(imageBytes, detectionMaxImageSize);
  const result = await plantIdentifier.identify(resizedBytes, 'image/jpeg');
  await withTransaction((client) => persistPlantIdentification(client, spotId, userId, result));
  if (result.usage && primaryProvider) {
    await recordLlmUsage(
      dbPool,
      buildUsageRow({
        spotId,
        purpose: 'plant-identification',
        providerLabel: primaryProvider.label,
        providerHost: primaryProvider.host,
        model: result.usage.model,
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        },
      }),
    );
  }
  return { scientificName: result.scientificName };
}

const litterDetectionWorker = new Worker<SpotJobData>(
  queueName,
  async (job: Job<SpotJobData>) => {
    const { spotId, userId, imageKey, mimeType, subjectKind } = job.data;

    if (!spotId || !userId || !imageKey || !mimeType) {
      throw new Error('Invalid job payload');
    }

    await writeWorkerState({
      lastHeartbeatAt: nowIsoString(),
      lastJobStartedAt: nowIsoString(),
    });

    await markSpotProcessing(spotId, userId);

    if (subjectKind === 'plant') {
      const { scientificName } = await runPlantIdentification(spotId, userId, imageKey);
      return { spotId, scientificName, completedAt: new Date().toISOString() };
    }

    const { count } = await runLitterDetection(spotId, userId, imageKey);
    return { spotId, detectedItems: count, completedAt: new Date().toISOString() };
  },
  {
    connection: redisConnection,
    concurrency: workerConcurrency,
  },
);

litterDetectionWorker.on('completed', (job) => {
  void writeWorkerState({
    lastHeartbeatAt: nowIsoString(),
    lastJobCompletedAt: nowIsoString(),
    lastFailedError: null,
  });
  console.log(`Detection completed for spot ${job.id}`);
});

litterDetectionWorker.on('failed', async (job, error) => {
  const spotId = job?.data?.spotId;
  const userId = job?.data?.userId;

  if (spotId && userId) {
    await markSpotFailed(spotId, userId, error.message);
  }

  await writeWorkerState({
    lastHeartbeatAt: nowIsoString(),
    lastJobFailedAt: nowIsoString(),
    lastFailedError: error.message.slice(0, 1000),
  });

  console.error(`Detection failed for spot ${spotId || 'unknown'}`, error);
});

await publishHeartbeat();
const heartbeatInterval = setInterval(() => {
  void publishHeartbeat();
}, workerHeartbeatIntervalMs);

console.log(`Detection worker started. Queue: ${queueName}, plant-identifier: ${plantIdentifierMode}`);

const shutdown = async () => {
  console.log('Shutting down detection worker...');
  clearInterval(heartbeatInterval);
  await litterDetectionWorker.close();
  await redisClient.quit();
  await dbPool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
