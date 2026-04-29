import { Injectable, Logger } from '@nestjs/common';

export type ClientEventType =
  | 'pick.upload.failed'
  | 'pick.upload.skipped.identity-mismatch';

export type IdentityHint = 'matches' | 'mismatch' | 'no-current-identity';

export interface ClientEventPayload {
  eventType: ClientEventType;
  occurredAt: string;
  itemId: string;
  attempts: number;
  ageMs: number;
  status?: number | null;
  message?: string;
  identityHint?: IdentityHint;
}

export interface RecordedClientEvent extends ClientEventPayload {
  identity: string;
}

@Injectable()
export class ClientEventsService {
  private readonly logger = new Logger('ClientEvents');

  record(event: RecordedClientEvent): void {
    this.logger.warn(JSON.stringify(event));
  }
}
