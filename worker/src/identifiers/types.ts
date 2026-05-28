export interface PlantIdentificationResult {
  scientificName: string | null;
  commonName: string | null;
  confidence: number | null;
  source: 'plantnet' | 'mistral';
  raw: unknown;
}

export interface PlantIdentifier {
  identify(image: Uint8Array, mimeType: string): Promise<PlantIdentificationResult>;
}
