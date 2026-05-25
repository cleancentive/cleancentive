import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConnection } from '../common/redis-connection';

const pkg = require(require('path').join(process.cwd(), 'package.json'));

interface WorkerOpsState {
  commit?: string;
  commitShort?: string;
  buildTime?: number;
}

export interface ArtifactVersion {
  commit: string;
  commitShort: string;
  buildTime: number;
}

@Injectable()
export class SystemService {
  private readonly queueName = process.env.DETECTION_QUEUE_NAME || 'litter-detection';
  private readonly workerOpsKey = `ops:worker:${this.queueName}`;
  private readonly frontendUrl = process.env.FRONTEND_INTERNAL_URL || 'http://frontend';
  private readonly redisClient: Redis;

  constructor() {
    this.redisClient = new Redis(redisConnection());
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
    try {
      const raw = await this.redisClient.get(this.workerOpsKey);
      if (!raw) return null;
      const state = JSON.parse(raw) as WorkerOpsState;
      return {
        commit: state.commit || 'dev',
        commitShort: state.commitShort || 'dev',
        buildTime: state.buildTime ?? 0,
      };
    } catch {
      return null;
    }
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
