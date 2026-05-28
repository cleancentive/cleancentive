import type { PlantIdentifier, PlantIdentificationResult } from './types';

interface PlantNetSpecies {
  scientificNameWithoutAuthor?: string;
  commonNames?: string[];
}

interface PlantNetResultEntry {
  score?: number;
  species?: PlantNetSpecies;
}

interface PlantNetResponse {
  results?: PlantNetResultEntry[];
}

export class PlantNetIdentifier implements PlantIdentifier {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly project: string,
    private readonly minConfidence: number,
  ) {}

  async identify(image: Uint8Array, mimeType: string): Promise<PlantIdentificationResult> {
    const form = new FormData();
    const blob = new Blob([image], { type: mimeType || 'image/jpeg' });
    form.append('images', blob, `plant.${this.extensionFor(mimeType)}`);
    form.append('organs', 'auto');

    const url = `${this.baseUrl.replace(/\/$/, '')}/identify/${encodeURIComponent(this.project)}?api-key=${encodeURIComponent(this.apiKey)}&include-related-images=false&lang=en`;
    const response = await fetch(url, { method: 'POST', body: form });

    // 4xx from Pl@ntNet is "we looked but found nothing" (e.g. 404 "Species not found"
    // for photos lacking recognizable plant features). Return a no-match result so
    // the spot completes with "could not identify" rather than retrying as a failure.
    // Only 5xx and network errors should bubble up and trigger a BullMQ retry.
    if (response.status >= 400 && response.status < 500) {
      const body = await response.text();
      return {
        scientificName: null,
        commonName: null,
        confidence: null,
        source: 'plantnet',
        raw: { httpStatus: response.status, body: body.slice(0, 500) },
      };
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Pl@ntNet API ${response.status}: ${body.slice(0, 500)}`);
    }

    const parsed = (await response.json()) as PlantNetResponse;
    const top = parsed.results?.[0];
    const score = typeof top?.score === 'number' ? top.score : null;
    const scientificName = top?.species?.scientificNameWithoutAuthor ?? null;
    const commonName = top?.species?.commonNames?.[0] ?? null;

    if (!scientificName || score === null || score < this.minConfidence) {
      return { scientificName: null, commonName: null, confidence: score, source: 'plantnet', raw: parsed };
    }

    return { scientificName, commonName, confidence: score, source: 'plantnet', raw: parsed };
  }

  private extensionFor(mimeType: string): string {
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    return 'jpg';
  }
}
