// Image pipeline: copy a TACO original into the bundle and render a thumbnail,
// matching the app's storage conventions:
//   images/spots/{spotId}/original-{uploadId}.jpg
//   images/spots/{spotId}/thumbnail-{uploadId}.jpg
//
// Thumbnails mirror frontend/src/lib/thumbnail.ts (max dimension 320, JPEG q≈0.8).
// Source processing is cached by (path, downscale) because the same TACO file is
// reused across many spots — we only run sharp once per unique source.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

export interface SpotImageResult {
  sha256: string;
  mimeType: string;
  originalBytes: number;
  thumbnailBytes: number;
  filesWritten: number;
}

interface ProcessedSource {
  originalBuf: Buffer;
  thumbBuf: Buffer;
  sha256: string;
}

const sourceCache = new Map<string, Promise<ProcessedSource>>();

function processSource(srcAbsPath: string, downscaleMaxPx: number | null): Promise<ProcessedSource> {
  const cacheKey = `${srcAbsPath}|${downscaleMaxPx ?? 0}`;
  let cached = sourceCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const srcBytes = await readFile(srcAbsPath);
      const originalBuf =
        downscaleMaxPx && downscaleMaxPx > 0
          ? await sharp(srcBytes)
              .rotate()
              .resize(downscaleMaxPx, downscaleMaxPx, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer()
          : srcBytes; // verbatim copy (TACO originals are JPEG)
      const thumbBuf = await sharp(srcBytes)
        .rotate()
        .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const sha256 = createHash('sha256').update(originalBuf).digest('hex');
      return { originalBuf, thumbBuf, sha256 };
    })();
    sourceCache.set(cacheKey, cached);
  }
  return cached;
}

export async function writeSpotImage(opts: {
  srcAbsPath: string;
  imagesRoot: string; // <bundle>/images
  imageKey: string;
  thumbnailKey: string;
  downscaleMaxPx: number | null;
}): Promise<SpotImageResult> {
  const { originalBuf, thumbBuf, sha256 } = await processSource(opts.srcAbsPath, opts.downscaleMaxPx);

  const origPath = join(opts.imagesRoot, opts.imageKey);
  const thumbPath = join(opts.imagesRoot, opts.thumbnailKey);
  await mkdir(dirname(origPath), { recursive: true });
  await writeFile(origPath, originalBuf);
  await writeFile(thumbPath, thumbBuf);

  return {
    sha256,
    mimeType: 'image/jpeg',
    originalBytes: originalBuf.length,
    thumbnailBytes: thumbBuf.length,
    filesWritten: 2,
  };
}
