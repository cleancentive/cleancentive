import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Client } from 'pg';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v7 as uuidv7 } from 'uuid';

type SourceUser = {
  username?: string;
  litter?: SourceLitter[];
};

type SourceLitter = {
  lat?: number;
  lng?: number;
  type?: string;
  file?: {
    $binary?: {
      base64?: string;
    };
  };
  entries?: Array<{
    category?: string | null;
    material?: string | null;
    brand?: string | null;
    weight?: number | null;
  }>;
  time_stamp?:
  | {
    $date?: string;
  }
  | string;
};

type ImportStats = {
  usersSeen: number;
  usersCreated: number;
  usersReused: number;
  emailsCreated: number;
  reportsCreated: number;
  reportsFailed: number;
  itemsCreated: number;
  originalsUploaded: number;
  thumbnailsUploaded: number;
  skippedUsers: number;
  skippedReports: number;
};

const execFileAsync = promisify(execFile);
const DEFAULT_LOCATION_ACCURACY_METERS = 25;
const THUMBNAIL_MAX_SIZE = 512;
const THUMBNAIL_JPEG_QUALITY = 80;

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage(): void {
  console.log('Usage: bun run scripts/import-mongo-export.ts --input <path-to-users.ndjson>');
  console.log('');
  console.log('Optional flags:');
  console.log('  --accuracy <number>   Default location accuracy meters (default: 25)');
  console.log('  --help                Show this help');
}

function getFileExtension(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function parseCapturedAt(value: SourceLitter['time_stamp']): Date {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (value && typeof value === 'object' && value.$date) {
    const date = new Date(value.$date);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return new Date();
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function ensureBucketExists(s3Client: S3Client, bucketName: string): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
}

async function createThumbnailJpeg(imageBuffer: Buffer): Promise<Buffer> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'cleancentive-thumb-'));
  const inputPath = join(tempDirectory, 'input.jpg');
  const outputPath = join(tempDirectory, 'thumb.jpg');

  try {
    await writeFile(inputPath, imageBuffer);

    await execFileAsync('sips', [
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      String(THUMBNAIL_JPEG_QUALITY),
      '-Z',
      String(THUMBNAIL_MAX_SIZE),
      inputPath,
      '--out',
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (hasArg('--help')) {
    printUsage();
    return;
  }

  const inputPath = getArgValue('--input');
  if (!inputPath) {
    printUsage();
    process.exit(1);
  }

  const defaultAccuracy = toFiniteNumber(getArgValue('--accuracy'), DEFAULT_LOCATION_ACCURACY_METERS);
  if (defaultAccuracy <= 0) {
    throw new Error('Default accuracy must be greater than 0');
  }

  const dbClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'cleancentive',
    password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
    database: process.env.DB_DATABASE || 'cleancentive',
  });

  const bucketName = process.env.S3_BUCKET || 'cleancentive-images';
  const s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9002',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });

  const stats: ImportStats = {
    usersSeen: 0,
    usersCreated: 0,
    usersReused: 0,
    emailsCreated: 0,
    reportsCreated: 0,
    reportsFailed: 0,
    itemsCreated: 0,
    originalsUploaded: 0,
    thumbnailsUploaded: 0,
    skippedUsers: 0,
    skippedReports: 0,
  };

  const failures: string[] = [];

  await dbClient.connect();
  await ensureBucketExists(s3Client, bucketName);

  const existingUserRows = await dbClient.query<{ id: string; nickname: string }>('SELECT id, nickname FROM users');
  const userByNickname = new Map<string, string>();
  for (const row of existingUserRows.rows) {
    if (!userByNickname.has(row.nickname)) {
      userByNickname.set(row.nickname, row.id);
    }
  }

  const existingEmailRows = await dbClient.query<{ email: string }>('SELECT email FROM user_emails');
  const usedEmails = new Set(existingEmailRows.rows.map((row) => row.email));
  let emailCounter = 1;

  const getNextEmail = (): string => {
    while (usedEmails.has(`nobody-${emailCounter}@culm.at`)) {
      emailCounter += 1;
    }
    const email = `nobody-${emailCounter}@culm.at`;
    usedEmails.add(email);
    emailCounter += 1;
    return email;
  };

  const lineReader = createInterface({
    input: createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    if (!line.trim()) continue;

    let sourceUser: SourceUser;
    try {
      sourceUser = JSON.parse(line) as SourceUser;
    } catch {
      stats.skippedUsers += 1;
      failures.push('Skipped malformed user JSON line');
      continue;
    }

    const nickname = typeof sourceUser.username === 'string' ? sourceUser.username.trim() : '';
    if (!nickname) {
      stats.skippedUsers += 1;
      failures.push('Skipped user with empty username');
      continue;
    }

    stats.usersSeen += 1;

    let userId = userByNickname.get(nickname);
    let isNewUser = false;

    if (!userId) {
      userId = uuidv7();
      await dbClient.query(
        `
          INSERT INTO users (id, nickname, full_name, last_login, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [userId, nickname, null, null, userId, userId],
      );

      userByNickname.set(nickname, userId);
      stats.usersCreated += 1;
      isNewUser = true;
    } else {
      stats.usersReused += 1;
    }

    if (isNewUser) {
      const email = getNextEmail();
      const emailId = uuidv7();
      await dbClient.query(
        `
          INSERT INTO user_emails (id, email, is_selected_for_login, user_id, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [emailId, email, true, userId, userId, userId],
      );
      stats.emailsCreated += 1;
    }

    const litterReports = Array.isArray(sourceUser.litter) ? sourceUser.litter : [];

    for (const litter of litterReports) {
      const lat = toFiniteNumber(litter?.lat, NaN);
      const lng = toFiniteNumber(litter?.lng, NaN);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        stats.skippedReports += 1;
        failures.push(`Skipped report for user ${nickname}: invalid coordinates`);
        continue;
      }

      const base64Image = litter?.file?.$binary?.base64;
      if (!base64Image) {
        stats.skippedReports += 1;
        failures.push(`Skipped report for user ${nickname}: missing image payload`);
        continue;
      }

      const mimeType = typeof litter.type === 'string' && litter.type.trim() ? litter.type : 'image/jpeg';
      const capturedAt = parseCapturedAt(litter.time_stamp);
      const reportId = uuidv7();
      const uploadId = uuidv7();
      const fileExt = getFileExtension(mimeType);
      const imageKey = `spots/${reportId}/original-${uploadId}.${fileExt}`;
      const thumbnailKey = `spots/${reportId}/thumbnail-${uploadId}.jpg`;

      let imageBuffer: Buffer;
      try {
        imageBuffer = Buffer.from(base64Image, 'base64');
      } catch {
        stats.skippedReports += 1;
        failures.push(`Skipped report for user ${nickname}: invalid base64 image`);
        continue;
      }

      try {
        await dbClient.query(
          `
            INSERT INTO spots (
              id,
              user_id,
              latitude,
              longitude,
              location_accuracy_meters,
              captured_at,
              mime_type,
              image_key,
              thumbnail_key,
              upload_id,
              processing_status,
              detection_started_at,
              detection_completed_at,
              processing_error,
              detection_raw,
              created_by,
              updated_by
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12, $13,
              $14, $15::jsonb, $16, $17
            )
          `,
          [
            reportId,
            userId,
            lat,
            lng,
            defaultAccuracy,
            capturedAt,
            mimeType,
            '',
            null,
            uploadId,
            'completed',
            capturedAt,
            capturedAt,
            null,
            JSON.stringify({ legacy_entries: Array.isArray(litter.entries) ? litter.entries : [] }),
            userId,
            userId,
          ],
        );

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: imageKey,
            Body: imageBuffer,
            ContentType: mimeType,
          }),
        );
        stats.originalsUploaded += 1;

        let thumbnailBuffer: Buffer | null = null;
        try {
          thumbnailBuffer = await createThumbnailJpeg(imageBuffer);
        } catch {
          failures.push(`Thumbnail generation failed for report ${reportId}; stored without thumbnail`);
        }

        let resolvedThumbnailKey: string | null = null;
        if (thumbnailBuffer) {
          await s3Client.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: thumbnailKey,
              Body: thumbnailBuffer,
              ContentType: 'image/jpeg',
            }),
          );
          resolvedThumbnailKey = thumbnailKey;
          stats.thumbnailsUploaded += 1;
        }

        await dbClient.query(
          `
            UPDATE spots
            SET image_key = $1,
                thumbnail_key = $2,
                updated_by = $3,
                updated_at = NOW()
            WHERE id = $4
          `,
          [imageKey, resolvedThumbnailKey, userId, reportId],
        );

        stats.reportsCreated += 1;

        const entries = Array.isArray(litter.entries) ? litter.entries : [];
        for (const entry of entries) {
          const weight = toFiniteNumber(entry?.weight, NaN);
          const weightGrams = Number.isFinite(weight) ? weight : null;

          await dbClient.query(
            `
              INSERT INTO detected_items (
                id,
                spot_id,
                category,
                material,
                brand,
                weight_grams,
                confidence,
                source_model,
                created_by,
                updated_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `,
            [
              uuidv7(),
              reportId,
              entry?.category ?? null,
              entry?.material ?? null,
              entry?.brand ?? null,
              weightGrams,
              null,
              null,
              userId,
              userId,
            ],
          );
          stats.itemsCreated += 1;
        }
      } catch (error) {
        stats.reportsFailed += 1;
        failures.push(`Failed report for user ${nickname}: ${(error as Error).message}`);
        try {
          await dbClient.query('DELETE FROM spots WHERE id = $1', [reportId]);
        } catch {
          failures.push(`Cleanup failed for partially created report ${reportId}`);
        }
      }
    }
  }

  await dbClient.end();

  console.log('Import finished');
  console.log(JSON.stringify(stats, null, 2));

  if (failures.length > 0) {
    console.log('');
    console.log(`Failures (${failures.length}):`);
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
  }
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
