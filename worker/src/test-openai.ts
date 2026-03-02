/**
 * Quick connectivity test for the vision API.
 *
 * Uses the same env vars as the worker:
 *   ANALYSIS_API_KEY  — required
 *   ANALYSIS_BASE_URL — optional, defaults to OpenAI
 *   ANALYSIS_MODEL    — optional, defaults to gpt-4o-mini
 *
 * Usage:
 *   bun run src/test-openai.ts [image1.jpg image2.jpg ...]
 *
 * Defaults to the first 3 images in ~/git/TACO/data/batch_1 when no args given.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import OpenAI from 'openai';

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

const DEFAULT_IMAGE_DIR = resolve(process.env.HOME || '/root', 'git/TACO/data/batch_1');
const DEFAULT_IMAGES = ['000000.jpg', '000001.jpg', '000003.jpg'].map(
  (f) => `${DEFAULT_IMAGE_DIR}/${f}`,
);

const imagePaths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_IMAGES;

const apiKey = process.env.ANALYSIS_API_KEY;
if (!apiKey) {
  console.error('ERROR: ANALYSIS_API_KEY is not set');
  process.exit(1);
}

const baseURL = process.env.ANALYSIS_BASE_URL;
const model = process.env.ANALYSIS_MODEL || 'gpt-4o-mini';

const openai = new OpenAI({
  apiKey,
  ...(baseURL ? { baseURL } : {}),
});

const RETRY_DELAYS_MS = [5000, 15000, 30000];

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err instanceof Error && err.message.includes('429');
      if (is429 && attempt < RETRY_DELAYS_MS.length) {
        const delayMs = RETRY_DELAYS_MS[attempt];
        console.log(`  Rate limited — retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})...`);
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Unreachable');
}

async function analyzeImage(imagePath: string): Promise<void> {
  const absPath = resolve(imagePath);
  const bytes = readFileSync(absPath);
  const mimeType = 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;

  console.log(`\n--- ${absPath} ---`);
  console.log(`Sending to ${baseURL ?? 'https://api.openai.com/v1'} ...`);

  const startMs = Date.now();
  const completion = await withRetry(() => openai.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this cleanup image and return litter objects.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  }));

  const elapsedMs = Date.now() - startMs;
  const raw = completion.choices[0]?.message?.content ?? '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('Failed to parse JSON response:', raw);
    return;
  }

  console.log(`Model: ${completion.model}  |  Latency: ${elapsedMs}ms`);
  console.log(
    `Tokens: ${completion.usage?.prompt_tokens} prompt + ${completion.usage?.completion_tokens} completion`,
  );
  console.log('Result:', JSON.stringify(parsed, null, 2));
}

(async () => {
  console.log(`Testing connectivity — model: ${model}, base: ${baseURL ?? 'https://api.openai.com/v1'}`);
  console.log(`Images to analyze: ${imagePaths.length}`);

  let passed = 0;
  let failed = 0;

  for (const imagePath of imagePaths) {
    try {
      await analyzeImage(imagePath);
      passed++;
    } catch (err) {
      console.error(`FAILED: ${imagePath}`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
