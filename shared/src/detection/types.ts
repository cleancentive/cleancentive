export interface LitterDetectionJobData {
  spotId: string;
  userId: string;
  imageKey: string;
  mimeType: string;
}

export interface DetectedObject {
  category: string | null;
  material: string | null;
  brand: string | null;
  weightGrams: number | null;
  confidence: number | null;
}

export interface DetectionResult {
  objects: DetectedObject[];
  notes: string | null;
}
