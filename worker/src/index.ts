import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import OpenAI from 'openai';
import { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { hostname } from 'os';

interface ImageAnalysisJobData {
  reportId: string;
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

interface AnalysisResult {
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
}

const queueName = process.env.ANALYSIS_QUEUE_NAME || 'image-analysis';
const analysisModel = process.env.ANALYSIS_MODEL || 'gpt-4o-mini';
const analysisBaseUrl = process.env.ANALYSIS_BASE_URL;
const bucketName = process.env.S3_BUCKET || 'cleancentive-images';
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
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  user: process.env.DATABASE_USER || 'cleancentive',
  password: process.env.DATABASE_PASSWORD || 'cleancentive_dev_password',
  database: process.env.DATABASE_NAME || 'cleancentive',
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

const analysisApiKey = process.env.ANALYSIS_API_KEY;
const openai = analysisApiKey
  ? new OpenAI({
      apiKey: analysisApiKey,
      ...(analysisBaseUrl ? { baseURL: analysisBaseUrl } : {}),
    })
  : null;

const SYSTEM_PROMPT = `You analyze cleanup photos and return JSON only.
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

Rules:
- Be conservative and only return visible litter items.
- category/material/brand may be null if uncertain.
- weightGrams should be estimated as a number in grams when possible.
- confidence is a number in [0,1].`;

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

async function analyzeImage(imageBytes: Uint8Array, mimeType: string): Promise<AnalysisResult> {
  if (!openai) {
    throw new Error('ANALYSIS_API_KEY is not configured for the worker');
  }

  const dataUrl = `data:${mimeType};base64,${Buffer.from(imageBytes).toString('base64')}`;

  const completion = await openai.chat.completions.create({
    model: analysisModel,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this cleanup image and return litter objects.' },
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

async function markReportProcessing(reportId: string, userId: string): Promise<void> {
  await dbPool.query(
    `
      UPDATE cleanup_reports
      SET processing_status = 'processing',
          analysis_started_at = NOW(),
          processing_error = NULL,
          updated_at = NOW(),
          updated_by = $2
      WHERE id = $1
    `,
    [reportId, userId],
  );
}

async function markReportFailed(reportId: string, userId: string, errorMessage: string): Promise<void> {
  const truncatedError = errorMessage.slice(0, 4000);

  await dbPool.query(
    `
      UPDATE cleanup_reports
      SET processing_status = 'failed',
          processing_error = $3,
          updated_at = NOW(),
          updated_by = $2
      WHERE id = $1
    `,
    [reportId, userId, truncatedError],
  );
}

async function persistAnalysis(
  reportId: string,
  userId: string,
  analysis: AnalysisResult,
  model: string,
): Promise<void> {
  const analysisRaw = {
    objects: analysis.objects,
    notes: analysis.notes,
    model,
  };

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM litter_items WHERE report_id = $1`, [reportId]);

    for (const object of analysis.objects) {
      await client.query(
        `
          INSERT INTO litter_items (
            id,
            created_at,
            updated_at,
            created_by,
            updated_by,
            report_id,
            category,
            material,
            brand,
            weight_grams,
            confidence,
            source_model
          )
          VALUES ($1, NOW(), NOW(), $2, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          uuidv7(),
          userId,
          reportId,
          object.category,
          object.material,
          object.brand,
          object.weightGrams,
          object.confidence,
          model,
        ],
      );
    }

    await client.query(
      `
        UPDATE cleanup_reports
        SET processing_status = 'completed',
            analysis_completed_at = NOW(),
            processing_error = NULL,
            analysis_raw = $1::jsonb,
            updated_at = NOW(),
            updated_by = $2
        WHERE id = $3
      `,
      [JSON.stringify(analysisRaw), userId, reportId],
    );
  });
}

const imageAnalysisWorker = new Worker<ImageAnalysisJobData>(
  queueName,
  async (job: Job<ImageAnalysisJobData>) => {
    const { reportId, userId, imageKey, mimeType } = job.data;

    if (!reportId || !userId || !imageKey || !mimeType) {
      throw new Error('Invalid job payload');
    }

    await writeWorkerState({
      lastHeartbeatAt: nowIsoString(),
      lastJobStartedAt: nowIsoString(),
    });

    await markReportProcessing(reportId, userId);

    const imageBytes = await fetchImageBytes(imageKey);
    const analysis = await analyzeImage(imageBytes, mimeType);
    await persistAnalysis(reportId, userId, analysis, analysisModel);

    return {
      reportId,
      analyzedObjects: analysis.objects.length,
      completedAt: new Date().toISOString(),
    };
  },
  {
    connection: redisConnection,
    concurrency: workerConcurrency,
  },
);

imageAnalysisWorker.on('completed', (job) => {
  void writeWorkerState({
    lastHeartbeatAt: nowIsoString(),
    lastJobCompletedAt: nowIsoString(),
    lastFailedError: null,
  });
  console.log(`Image analysis completed for report ${job.id}`);
});

imageAnalysisWorker.on('failed', async (job, error) => {
  const reportId = job?.data?.reportId;
  const userId = job?.data?.userId;

  if (reportId && userId) {
    await markReportFailed(reportId, userId, error.message);
  }

  await writeWorkerState({
    lastHeartbeatAt: nowIsoString(),
    lastJobFailedAt: nowIsoString(),
    lastFailedError: error.message.slice(0, 1000),
  });

  console.error(`Image analysis failed for report ${reportId || 'unknown'}`, error);
});

await publishHeartbeat();
const heartbeatInterval = setInterval(() => {
  void publishHeartbeat();
}, workerHeartbeatIntervalMs);

console.log(`Image analysis worker started. Queue: ${queueName}`);

const shutdown = async () => {
  console.log('Shutting down image analysis worker...');
  clearInterval(heartbeatInterval);
  await imageAnalysisWorker.close();
  await redisClient.quit();
  await dbPool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
