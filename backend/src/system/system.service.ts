import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Spot } from '../spot/spot.entity';
import { redisConnection } from '../common/redis-connection';

const pkg = require(require('path').join(process.cwd(), 'package.json'));

interface WorkerOpsState {
  commit?: string;
  commitShort?: string;
  buildTime?: number;
  lastJobCompletedAt?: string;
  lastJobFailedAt?: string;
}

export type DetectionHealthStatus = 'ok' | 'degraded' | 'down';

export interface DetectionSignals {
  completed: number;
  failed: number;
  stuck: number;
  workerLastAttemptFailed: boolean;
  windowHours: number;
  stuckMinutes: number;
}

export interface DetectionHealth {
  status: DetectionHealthStatus;
  reason: string;
  windowHours: number;
  completed: number;
  failed: number;
  stuck: number;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
}

export interface ArtifactVersion {
  commit: string;
  commitShort: string;
  buildTime: number;
}

export function classifyDetectionHealth(
  signals: DetectionSignals,
): { status: DetectionHealthStatus; reason: string } {
  const { completed, failed, stuck, workerLastAttemptFailed, windowHours, stuckMinutes } = signals;

  if (workerLastAttemptFailed) {
    return { status: 'down', reason: 'the last detection the worker attempted failed and none has succeeded since' };
  }
  if (failed > 0 && completed === 0) {
    return { status: 'down', reason: `every detection in the last ${windowHours}h failed (${failed})` };
  }
  if (failed > 0) {
    return {
      status: 'degraded',
      reason: `${failed} of ${failed + completed} detections failed in the last ${windowHours}h`,
    };
  }
  if (stuck > 0) {
    return {
      status: 'degraded',
      reason: `${stuck} spot(s) have been awaiting detection for over ${stuckMinutes} minutes`,
    };
  }
  return { status: 'ok', reason: 'detections are completing' };
}

@Injectable()
export class SystemService {
  private readonly queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
  private readonly workerOpsKey = `ops:worker:${this.queueName}`;
  private readonly frontendUrl = process.env.FRONTEND_INTERNAL_URL || 'http://frontend';
  private readonly redisClient: Redis;

  private readonly windowHours = parseInt(process.env.DETECTION_HEALTH_WINDOW_HOURS || '24', 10);
  private readonly stuckMinutes = parseInt(process.env.DETECTION_HEALTH_STUCK_MINUTES || '30', 10);

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
  ) {
    this.redisClient = new Redis(redisConnection());
  }

  /**
   * Whether detections are actually succeeding — which the infrastructure health
   * check cannot tell you. During the 2026-09 outage the worker heartbeat stayed
   * fresh and every dependency was up while every single detection failed, so
   * "all systems ok" was reported for nine days.
   *
   * Two independent signals, because either alone has a blind spot:
   *  - a 24h window of outcomes, which misses quiet periods with no uploads;
   *  - the worker's last terminal job, which persists through those quiet periods.
   */
  async getDetectionHealth(): Promise<DetectionHealth> {
    const [row] = (await this.spotRepository.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE processing_status = 'completed' AND updated_at > NOW() - ($1 || ' hours')::interval) AS completed,
          COUNT(*) FILTER (WHERE processing_status = 'failed'    AND updated_at > NOW() - ($1 || ' hours')::interval) AS failed,
          COUNT(*) FILTER (WHERE processing_status IN ('queued', 'processing') AND created_at < NOW() - ($2 || ' minutes')::interval) AS stuck,
          MAX(updated_at) FILTER (WHERE processing_status = 'completed') AS last_completed_at,
          MAX(updated_at) FILTER (WHERE processing_status = 'failed')    AS last_failed_at
        FROM spots
      `,
      [String(this.windowHours), String(this.stuckMinutes)],
    )) as Array<Record<string, string | Date | null>>;

    const completed = Number(row?.completed ?? 0);
    const failed = Number(row?.failed ?? 0);
    const stuck = Number(row?.stuck ?? 0);
    const toIso = (value: string | Date | null | undefined): string | null =>
      value ? new Date(value).toISOString() : null;

    const worker = await this.getWorkerOpsState();
    const workerLastAttemptFailed =
      !!worker?.lastJobFailedAt &&
      (!worker.lastJobCompletedAt || Date.parse(worker.lastJobFailedAt) > Date.parse(worker.lastJobCompletedAt));

    const { status, reason } = classifyDetectionHealth({
      completed,
      failed,
      stuck,
      workerLastAttemptFailed,
      windowHours: this.windowHours,
      stuckMinutes: this.stuckMinutes,
    });

    return {
      status,
      reason,
      windowHours: this.windowHours,
      completed,
      failed,
      stuck,
      lastCompletedAt: toIso(row?.last_completed_at),
      lastFailedAt: toIso(row?.last_failed_at),
    };
  }

  private async getWorkerOpsState(): Promise<WorkerOpsState | null> {
    try {
      const raw = await this.redisClient.get(this.workerOpsKey);
      return raw ? (JSON.parse(raw) as WorkerOpsState) : null;
    } catch {
      return null;
    }
  }

  async getVersion(): Promise<{
    backend: ArtifactVersion;
    frontend: ArtifactVersion | null;
    worker: ArtifactVersion | null;
  }> {
    const [frontend, worker] = await Promise.all([this.getFrontendVersion(), this.getWorkerVersion()]);
    return {
      backend: {
        commit: pkg.commit || 'dev',
        commitShort: pkg.commitShort || 'dev',
        buildTime: pkg.buildTime ?? 0,
      },
      frontend,
      worker,
    };
  }

  private async getWorkerVersion(): Promise<ArtifactVersion | null> {
    const state = await this.getWorkerOpsState();
    if (!state) return null;
    return {
      commit: state.commit || 'dev',
      commitShort: state.commitShort || 'dev',
      buildTime: state.buildTime ?? 0,
    };
  }

  private async getFrontendVersion(): Promise<ArtifactVersion | null> {
    try {
      const res = await fetch(`${this.frontendUrl}/version.json`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Partial<ArtifactVersion>;
      return {
        commit: data.commit || 'dev',
        commitShort: data.commitShort || 'dev',
        buildTime: data.buildTime ?? 0,
      };
    } catch {
      return null;
    }
  }
}
