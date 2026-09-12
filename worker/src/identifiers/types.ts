/** Token usage for an identification that went to a paid model. */
export interface PlantIdentificationUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface PlantIdentificationResult {
  scientificName: string | null;
  commonName: string | null;
  confidence: number | null;
  source: 'plantnet' | 'mistral';
  raw: unknown;
  /** Absent for Pl@ntNet, which we do not pay per call. */
  usage?: PlantIdentificationUsage;
}

export interface PlantIdentifier {
  identify(image: Uint8Array, mimeType: string): Promise<PlantIdentificationResult>;
}
