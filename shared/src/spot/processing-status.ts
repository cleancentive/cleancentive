export type ProcessingStatus = 'queued' | 'processing' | 'completed' | 'failed';

export const PROCESSING_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const satisfies Record<string, ProcessingStatus>;
