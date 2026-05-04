import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { OutlineSyncService } from '../outline-sync/outline-sync.service';

export const INTEGRATION_QUEUE = 'cleancentive-integrations';
export const INTEGRATION_QUEUE_INSTANCE = Symbol('INTEGRATION_QUEUE_INSTANCE');
export const OUTLINE_BOOTSTRAP_JOB = 'outline.bootstrap';
export const OUTLINE_RECONCILE_JOB = 'outline.reconcile';
export const OUTLINE_SYNC_EVENT_JOB = 'outline.sync-event';

type OutlineEventName =
  | 'user.profile-changed'
  | 'user.avatar-changed'
  | 'admin.promoted'
  | 'admin.demoted'
  | 'team.member-joined'
  | 'team.member-left'
  | 'team.created'
  | 'team.renamed'
  | 'team.archived'
  | 'user.anonymized'
  | 'user.deleted';

const redisConnection = () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
});

const defaultOptions: JobsOptions = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
};

@Injectable()
export class IntegrationQueueService implements OnModuleDestroy {
  private readonly queue: Pick<Queue, 'add' | 'close'>;

  constructor(@Optional() @Inject(INTEGRATION_QUEUE_INSTANCE) queue?: Pick<Queue, 'add' | 'close'>) {
    this.queue = queue ?? new Queue(INTEGRATION_QUEUE, { connection: redisConnection() });
  }

  async enqueueOutlineBootstrap(payload: { userId?: string } = {}): Promise<void> {
    await this.queue.add(OUTLINE_BOOTSTRAP_JOB, payload, defaultOptions);
  }

  async scheduleOutlineReconciliation(): Promise<void> {
    await this.queue.add(OUTLINE_RECONCILE_JOB, {}, {
      ...defaultOptions,
      repeat: { pattern: '30 3 * * *' },
      jobId: OUTLINE_RECONCILE_JOB,
    });
  }

  async enqueueOutlineSyncEvent(eventName: OutlineEventName, payload: unknown): Promise<void> {
    await this.queue.add(OUTLINE_SYNC_EVENT_JOB, { eventName, payload }, defaultOptions);
  }

  @OnEvent('user.profile-changed')
  async handleUserProfileChanged(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('user.profile-changed', payload);
  }

  @OnEvent('user.avatar-changed')
  async handleUserAvatarChanged(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('user.avatar-changed', payload);
  }

  @OnEvent('admin.promoted')
  async handleAdminPromoted(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('admin.promoted', payload);
  }

  @OnEvent('admin.demoted')
  async handleAdminDemoted(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('admin.demoted', payload);
  }

  @OnEvent('team.member-joined')
  async handleTeamMemberJoined(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('team.member-joined', payload);
  }

  @OnEvent('team.member-left')
  async handleTeamMemberLeft(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('team.member-left', payload);
  }

  @OnEvent('team.created')
  async handleTeamCreated(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('team.created', payload);
  }

  @OnEvent('team.renamed')
  async handleTeamRenamed(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('team.renamed', payload);
  }

  @OnEvent('team.archived')
  async handleTeamArchived(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('team.archived', payload);
  }

  @OnEvent('user.anonymized')
  async handleUserAnonymized(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('user.anonymized', payload);
  }

  @OnEvent('user.deleted')
  async handleUserDeleted(payload: unknown): Promise<void> {
    await this.enqueueOutlineSyncEvent('user.deleted', payload);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close?.();
  }
}

@Injectable()
export class IntegrationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationWorkerService.name);
  private worker: Worker | null = null;

  constructor(
    private readonly outlineSyncService: OutlineSyncService,
    private readonly integrationQueueService: IntegrationQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(INTEGRATION_QUEUE, (job) => this.process(job), {
      connection: redisConnection(),
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Integration job ${job?.name} failed: ${err.message}`);
    });
    await this.integrationQueueService.enqueueOutlineBootstrap();
    await this.integrationQueueService.scheduleOutlineReconciliation();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Pick<Job, 'name' | 'data'>): Promise<void> {
    switch (job.name) {
      case OUTLINE_BOOTSTRAP_JOB:
        await this.outlineSyncService.bootstrap();
        return;
      case OUTLINE_RECONCILE_JOB:
        await this.outlineSyncService.reconcileTeamCollections();
        return;
      case OUTLINE_SYNC_EVENT_JOB: {
        const data = job.data as { eventName: OutlineEventName; payload: unknown };
        await this.outlineSyncService.processEvent(data.eventName, data.payload);
        return;
      }
      default:
        throw new Error(`Unknown integration job: ${job.name}`);
    }
  }
}
