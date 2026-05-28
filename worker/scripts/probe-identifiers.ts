/**
 * Run each fixture in worker/test/fixtures/plants/ through Pl@ntNet and (if
 * DETECTION_API_KEY is set) Mistral, print results side-by-side.
 *
 * Usage:
 *   cd worker
 *   bun scripts/probe-identifiers.ts
 *
 * Reads env from worker/.env automatically (bun loads it).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { PlantNetIdentifier } from '../src/identifiers/plantnet';
import { MistralPlantIdentifier } from '../src/identifiers/mistral-plant';
import { lookupInvasive } from '@cleancentive/shared/infoflora';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, '..', 'test', 'fixtures', 'plants');

// Maps file basename → species we'd expect the model to identify, for scoring.
const EXPECTED: Record<string, string> = {
  'knotweed.jpg': 'Reynoutria japonica',
  'giant-hogweed.jpg': 'Heracleum mantegazzianum',
  'himalayan-balsam.jpg': 'Impatiens glandulifera',
  'tree-of-heaven.jpg': 'Ailanthus altissima',
  'canadian-goldenrod.jpg': 'Solidago canadensis',
  'butterfly-bush.jpg': 'Buddleja davidii',
  'black-locust.jpg': 'Robinia pseudoacacia',
  'dandelion.jpg': 'Taraxacum officinale',
};

interface Row {
  file: string;
  expected: string;
  plantnet: { scientific: string | null; confidence: number | null; invasive: string | null; matchesExpected: boolean };
  mistral: { scientific: string | null; confidence: number | null; invasive: string | null; matchesExpected: boolean } | null;
}

function species(name: string | null | undefined): string {
  if (!name) return '-';
  return name.length > 32 ? name.slice(0, 30) + '..' : name;
}

function fmtConf(c: number | null | undefined): string {
  if (c === null || c === undefined) return '-';
  return (c * 100).toFixed(1) + '%';
}

function match(name: string | null, expected: string): boolean {
  if (!name) return false;
  return name.toLowerCase().includes(expected.toLowerCase().split(' ')[0]);
}

async function main() {
  if (!process.env.PLANTNET_API_KEY) {
    console.error('PLANTNET_API_KEY missing — set it in worker/.env');
    process.exit(1);
  }

  const plantnet = new PlantNetIdentifier(
    process.env.PLANTNET_API_KEY,
    process.env.PLANTNET_BASE_URL || 'https://my-api.plantnet.org/v2',
    process.env.PLANTNET_PROJECT || 'weurope',
    0, // no filtering — show everything
  );

  let mistral: MistralPlantIdentifier | null = null;
  if (process.env.DETECTION_API_KEY) {
    const openai = new OpenAI({
      apiKey: process.env.DETECTION_API_KEY,
      ...(process.env.DETECTION_BASE_URL ? { baseURL: process.env.DETECTION_BASE_URL } : {}),
    });
    mistral = new MistralPlantIdentifier(openai, process.env.DETECTION_MODEL || 'mistral-medium-latest');
  } else {
    console.warn('DETECTION_API_KEY missing — skipping Mistral probe');
  }

  const files = (await readdir(FIXTURE_DIR)).filter((f) => f.endsWith('.jpg')).sort();
  const rows: Row[] = [];

  for (const file of files) {
    const expected = EXPECTED[file] ?? '?';
    const buf = await readFile(join(FIXTURE_DIR, file));
    const bytes = new Uint8Array(buf);

    const row: Row = {
      file,
      expected,
      plantnet: { scientific: null, confidence: null, invasive: null, matchesExpected: false },
      mistral: null,
    };

    try {
      const r = await plantnet.identify(bytes, 'image/jpeg');
      row.plantnet.scientific = r.scientificName;
      row.plantnet.confidence = r.confidence;
      row.plantnet.invasive = r.scientificName ? lookupInvasive(r.scientificName)?.list ?? null : null;
      row.plantnet.matchesExpected = match(r.scientificName, expected);
    } catch (e: any) {
      row.plantnet.scientific = `ERR: ${e.message.slice(0, 50)}`;
    }

    if (mistral) {
      row.mistral = { scientific: null, confidence: null, invasive: null, matchesExpected: false };
      try {
        const r = await mistral.identify(bytes, 'image/jpeg');
        row.mistral.scientific = r.scientificName;
        row.mistral.confidence = r.confidence;
        row.mistral.invasive = r.scientificName ? lookupInvasive(r.scientificName)?.list ?? null : null;
        row.mistral.matchesExpected = match(r.scientificName, expected);
      } catch (e: any) {
        row.mistral.scientific = `ERR: ${e.message.slice(0, 50)}`;
      }
    }

    rows.push(row);
    process.stdout.write('.');
  }
  console.log();
  console.log();

  // Pretty table
  const header = ['File', 'Expected', 'Pl@ntNet', 'Conf', 'Inv', 'OK', 'Mistral', 'Conf', 'Inv', 'OK'];
  console.log(header.join('\t'));
  console.log(header.map(() => '─'.repeat(8)).join('\t'));
  for (const r of rows) {
    const pn = r.plantnet;
    const mi = r.mistral;
    console.log([
      r.file.replace('.jpg', ''),
      r.expected.split(' ')[0],
      species(pn.scientific),
      fmtConf(pn.confidence),
      pn.invasive ? pn.invasive.replace('infoflora_', '') : '-',
      pn.matchesExpected ? '✓' : '✗',
      mi ? species(mi.scientific) : 'n/a',
      mi ? fmtConf(mi.confidence) : '-',
      mi ? (mi.invasive ? mi.invasive.replace('infoflora_', '') : '-') : '-',
      mi ? (mi.matchesExpected ? '✓' : '✗') : '-',
    ].join('\t'));
  }

  // Threshold analysis
  console.log();
  console.log('── Threshold analysis (how many correct identifications survive each threshold)');
  const thresholds = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  console.log(['threshold', 'pn-correct', 'pn-wrong', 'mi-correct', 'mi-wrong'].join('\t'));
  for (const t of thresholds) {
    let pnOk = 0, pnBad = 0, miOk = 0, miBad = 0;
    for (const r of rows) {
      if (r.plantnet.confidence !== null && r.plantnet.confidence >= t) {
        if (r.plantnet.matchesExpected) pnOk++;
        else pnBad++;
      }
      if (r.mistral?.confidence !== null && r.mistral && r.mistral.confidence !== null && r.mistral.confidence >= t) {
        if (r.mistral.matchesExpected) miOk++;
        else miBad++;
      }
    }
    console.log([`>=${(t * 100).toFixed(0)}%`, pnOk, pnBad, miOk, miBad].join('\t'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
