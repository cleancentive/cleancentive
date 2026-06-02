// Bundle writer: emits the exact directory shape that db-export.ts produces and
// db-import.ts consumes — one <table>.ndjson per table plus manifest.json. Images
// are written separately by the image pipeline under <outDir>/images/<s3-key>.

import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface BundleManifest {
  version: number;
  exported_at: string;
  source_database: string;
  source_host: string;
  scope: string[];
  tables: Record<string, { row_count: number }>;
  images: { downloaded: number; failed: number; skipped: boolean };
}

export class BundleWriter {
  private streams = new Map<string, WriteStream>();
  private counts = new Map<string, number>();
  private columnSig = new Map<string, string>();

  constructor(private readonly outDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.outDir, { recursive: true });
  }

  // Append one row to a table file. Every row in a table MUST have the same key
  // set — db-import derives the column list from the first row only.
  write(table: string, row: Record<string, unknown>): void {
    const sig = Object.keys(row).join(',');
    let stream = this.streams.get(table);
    if (!stream) {
      stream = createWriteStream(join(this.outDir, `${table}.ndjson`));
      this.streams.set(table, stream);
      this.counts.set(table, 0);
      this.columnSig.set(table, sig);
    } else if (this.columnSig.get(table) !== sig) {
      throw new Error(
        `Column mismatch in ${table}.ndjson: first row [${this.columnSig.get(table)}], later row [${sig}]`,
      );
    }
    stream.write(`${JSON.stringify(row)}\n`);
    this.counts.set(table, (this.counts.get(table) ?? 0) + 1);
  }

  rowCount(table: string): number {
    return this.counts.get(table) ?? 0;
  }

  tablesWritten(): string[] {
    return [...this.streams.keys()];
  }

  async finalize(manifest: BundleManifest): Promise<void> {
    await Promise.all(
      [...this.streams.values()].map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.end();
            s.on('finish', resolve);
            s.on('error', reject);
          }),
      ),
    );
    await writeFile(join(this.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
