import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import OpenAI from 'openai';
import { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { hostname } from 'os';
import sharp from 'sharp';

interface LitterDetectionJobData {
  spotId: string;
  userId: string;
  imageKey: string;
  mimeType: string;
}

interface DetectedObject {
  category: string | null;
  material: string | null;
  brand: string | null;
  weightGrams: number | null;
  confidence: number | null;
}

interface DetectionResult {
  objects: DetectedObject[];
  notes: string | null;
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
  version: string;
  buildTime: number;
}

const pkg = require('../../package.json');

const queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
const detectionModel = process.env.DETECTION_MODEL || 'gpt-4o-mini';
const detectionBaseUrl = process.env.DETECTION_BASE_URL;
const bucketName = process.env.S3_BUCKET || 'cleancentive-images';
const detectionMaxImageSize = parseInt(process.env.DETECTION_MAX_IMAGE_SIZE || '1024', 10);
const workerConcurrency = 2;
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

const detectionApiKey = process.env.DETECTION_API_KEY;
const openai = detectionApiKey
  ? new OpenAI({
      apiKey: detectionApiKey,
      ...(detectionBaseUrl ? { baseURL: detectionBaseUrl } : {}),
    })
  : null;

interface LabelTaxonomy {
  objects: string[];
  materials: string[];
  brands: string[];
}

async function fetchLabelTaxonomy(): Promise<LabelTaxonomy> {
  const rows = await dbPool.query<{ type: string; name: string }>(
    `SELECT l.type, lt.name
     FROM labels l
     JOIN label_translations lt ON lt.label_id = l.id
     WHERE lt.locale = 'en'
     ORDER BY l.type, lt.name`,
  );

  const taxonomy: LabelTaxonomy = { objects: [], materials: [], brands: [] };
  for (const row of rows.rows) {
    if (row.type === 'object') taxonomy.objects.push(row.name);
    else if (row.type === 'material') taxonomy.materials.push(row.name);
    else if (row.type === 'brand') taxonomy.brands.push(row.name);
  }
  return taxonomy;
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

async function resolveOrCreateLabel(
  client: PoolClient,
  type: string,
  enName: string,
  userId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT l.id FROM labels l
     JOIN label_translations lt ON lt.label_id = l.id
     WHERE l.type = $1 AND lt.locale = 'en' AND LOWER(lt.name) = LOWER($2)`,
    [type, enName],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const labelId = uuidv7();
  const translationId = uuidv7();
  const titleCased = enName.replace(/\b\w/g, (c) => c.toUpperCase());

  await client.query(
    `INSERT INTO labels (id, type, created_at, updated_at, created_by, updated_by) VALUES ($1, $2, NOW(), NOW(), $3, $3)`,
    [labelId, type, userId],
  );
  await client.query(
    `INSERT INTO label_translations (id, label_id, locale, name, created_at, updated_at, created_by, updated_by) VALUES ($1, $2, 'en', $3, NOW(), NOW(), $4, $4)`,
    [translationId, labelId, titleCased, userId],
  );

  return labelId;
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
        weightGrams: asOptionalNumber(value.weightGrams),
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
    name: queueName,
    concurrency: workerConcurrency,
    hostname: hostname(),
    pid: process.pid,
    version: pkg.version || 'unknown',
    buildTime: pkg.buildTime ?? 0,
    ...current,
    ...patch,
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

async function detectLitter(imageBytes: Uint8Array, mimeType: string, systemPrompt: string): Promise<DetectionResult> {
  if (!openai) {
    throw new Error('DETECTION_API_KEY is not configured for the worker');
  }

  const dataUrl = `data:${mimeType};base64,${Buffer.from(imageBytes).toString('base64')}`;

  const completion = await openai.chat.completions.create({
    model: detectionModel,
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

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response');
  }

  const parsed = JSON.parse(content) as Record<string, unknown>;

  return {
    objects: normalizeObjects(parsed.objects),
    notes: asOptionalString(parsed.notes),
  };
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
  const detectionRaw = {
    objects: detection.objects,
    notes: detection.notes,
    model,
  };

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM detected_items WHERE spot_id = $1`, [spotId]);

    for (const object of detection.objects) {
      const objectLabelId = object.category
        ? await resolveOrCreateLabel(client, 'object', object.category, userId)
        : null;
      const materialLabelId = object.material
        ? await resolveOrCreateLabel(client, 'material', object.material, userId)
        : null;
      const brandLabelId = object.brand
        ? await resolveOrCreateLabel(client, 'brand', object.brand, userId)
        : null;

      await client.query(
        `
          INSERT INTO detected_items (
            id,
            created_at,
            updated_at,
            created_by,
            updated_by,
            spot_id,
            object_label_id,
            material_label_id,
            brand_label_id,
            weight_grams,
            confidence,
            source_model
          )
          VALUES ($1, NOW(), NOW(), $2, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          uuidv7(),
          userId,
          spotId,
          objectLabelId,
          materialLabelId,
          brandLabelId,
          object.weightGrams,
          object.confidence,
          model,
        ],
      );
    }

    await client.query(
      `
        UPDATE spots
        SET processing_status = 'completed',
            detection_completed_at = NOW(),
            processing_error = NULL,
            detection_raw = $1::jsonb,
            updated_at = NOW(),
            updated_by = $2
        WHERE id = $3
      `,
      [JSON.stringify(detectionRaw), userId, spotId],
    );
  });
}

const litterDetectionWorker = new Worker<LitterDetectionJobData>(
  queueName,
  async (job: Job<LitterDetectionJobData>) => {
    const { spotId, userId, imageKey, mimeType } = job.data;

    if (!spotId || !userId || !imageKey || !mimeType) {
      throw new Error('Invalid job payload');
    }

    await writeWorkerState({
      lastHeartbeatAt: nowIsoString(),
      lastJobStartedAt: nowIsoString(),
    });

    await markSpotProcessing(spotId, userId);

    const taxonomy = await fetchLabelTaxonomy();
    const systemPrompt = buildSystemPrompt(taxonomy);

    const imageBytes = await fetchImageBytes(imageKey);
    const resizedBytes = await resizeForDetection(imageBytes, detectionMaxImageSize);
    const detection = await detectLitter(resizedBytes, 'image/jpeg', systemPrompt);
    await persistDetection(spotId, userId, detection, detectionModel);

    return {
      spotId,
      detectedItems: detection.objects.length,
      completedAt: new Date().toISOString(),
    };
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
  console.log(`Litter detection completed for spot ${job.id}`);
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

  console.error(`Litter detection failed for spot ${spotId || 'unknown'}`, error);
});

await publishHeartbeat();
const heartbeatInterval = setInterval(() => {
  void publishHeartbeat();
}, workerHeartbeatIntervalMs);

console.log(`Litter detection worker started. Queue: ${queueName}`);

const shutdown = async () => {
  console.log('Shutting down litter detection worker...');
  clearInterval(heartbeatInterval);
  await litterDetectionWorker.close();
  await redisClient.quit();
  await dbPool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
