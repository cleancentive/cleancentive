import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { UserEmail } from '../user/user-email.entity';
import { resolveNotificationRecipients } from '../user/notification-recipients';
import { EmailService } from '../email/email.service';
import { emailStrings, type DetectionAlertReason } from '../email/email.i18n';
import { redisConnection } from '../common/redis-connection';
import { AdminService } from './admin.service';
import { AdminOpsService } from './admin-ops.service';
import {
  decideAlert as decideAlertGeneric,
  type ActionableState as GenericActionableState,
  type AlertDecision as GenericAlertDecision,
  type AlertState,
} from './alert-decision';

export type { AlertState };
export type ActionableState = GenericActionableState<DetectionAlertReason>;
export type AlertDecision = GenericAlertDecision<DetectionAlertReason>;

/** Identity of a condition for change detection — not shown to anyone. */
export function reasonKey(reason: DetectionAlertReason | null): string {
  if (!reason) return '';
  return reason.kind === 'worker-down' ? reason.kind : `${reason.kind}:${reason.count}`;
}

export function decideAlert(
  previous: AlertState | null,
  current: ActionableState,
  now: number,
  reAlertMs: number,
): AlertDecision {
  return decideAlertGeneric(previous, current, now, reAlertMs, reasonKey);
}

@Injectable()
export class DetectionAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DetectionAlertService.name);
  private readonly queueName = 'cleancentive-alerts';
  private readonly stateKey = 'ops:alert:detection:state';
  private readonly checkPattern = process.env.DETECTION_ALERT_CRON || '*/5 * * * *';
  private readonly reAlertMs =
    parseInt(process.env.DETECTION_ALERT_REPEAT_HOURS || '24', 10) * 60 * 60 * 1000;
  private queue: Queue;
  private worker: Worker;
  private readonly redis: Redis;

  constructor(
    @InjectRepository(UserEmail)
    private readonly userEmailRepository: Repository<UserEmail>,
    private readonly adminService: AdminService,
    private readonly adminOpsService: AdminOpsService,
    private readonly emailService: EmailService,
  ) {
    this.redis = new Redis(redisConnection());

    this.queue = new Queue(this.queueName, { connection: redisConnection() });
    this.worker = new Worker(
      this.queueName,
      async (job) => {
        if (job.name === 'detection-alert-check') {
          await this.check();
        }
      },
      { connection: redisConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Alert job ${job?.name} failed: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    if (process.env.DETECTION_ALERT_ENABLED === 'false') {
      this.logger.log('Detection alerts disabled (DETECTION_ALERT_ENABLED=false)');
      return;
    }

    await this.queue.add('detection-alert-check', {}, {
      repeat: { pattern: this.checkPattern },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.logger.log(`Detection alert check registered: ${this.checkPattern}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.redis?.disconnect();
  }

  async check(): Promise<AlertDecision> {
    const overview = await this.adminOpsService.getOverview();
    const current = describeActionableState(overview);

    const previous = await this.readState();
    const decision = decideAlert(previous, current, Date.now(), this.reAlertMs);

    if (!decision.send) return decision;

    await this.notify(decision);
    await this.redis.set(
      this.stateKey,
      JSON.stringify({
        needsAction: current.needsAction,
        reasonKey: reasonKey(current.reason),
        notifiedAt: new Date().toISOString(),
      } satisfies AlertState),
    );

    return decision;
  }

  private async readState(): Promise<AlertState | null> {
    try {
      const raw = await this.redis.get(this.stateKey);
      return raw ? (JSON.parse(raw) as AlertState) : null;
    } catch {
      return null;
    }
  }

  private async notify(decision: Extract<AlertDecision, { send: true }>): Promise<void> {
    const adminIds = await this.adminService.getAdminUserIds();
    const recipients = await resolveNotificationRecipients(this.userEmailRepository, adminIds);
    if (recipients.length === 0) {
      this.logger.warn('Detection needs attention but no steward has a login email configured');
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/steward/operations`;
    const recovered = decision.kind === 'recovered';

    await this.emailService.sendCommunityMessage(recipients, null, (locale) => {
      const strings = emailStrings(locale).detectionAlert;
      return {
        subject: recovered ? strings.recoveredSubject : strings.subject,
        preheader: recovered ? strings.recoveredPreheader : strings.preheader,
        title: recovered ? strings.recoveredTitle : strings.title,
        body: [
          recovered ? strings.recoveredIntro : strings.intro,
          ...(decision.reason ? ['', `**${strings.reasonLabel}:** ${strings.reason(decision.reason)}`] : []),
          '',
          strings.action(link),
        ].join('\n'),
        disclosure: strings.disclosure,
      };
    });

    this.logger.log(`Detection alert (${decision.kind}) sent to ${recipients.length} steward(s)`);
  }
}

type Overview = Awaited<ReturnType<AdminOpsService['getOverview']>>;

/**
 * Turns the ops overview into the one question an alert cares about: does a
 * steward need to do something, and what?
 *
 * Mirrors getOverallHealthStatus deliberately — the mail and the badge must never
 * disagree about whether there is a problem.
 */
export function describeActionableState(overview: Overview): ActionableState {
  if (!overview.worker.healthy) {
    return { needsAction: true, reason: { kind: 'worker-down' } };
  }
  if (overview.spots.retryableFailed > 0) {
    return { needsAction: true, reason: { kind: 'retryable-failed', count: overview.spots.retryableFailed } };
  }
  if (overview.spots.stalled > 0) {
    return { needsAction: true, reason: { kind: 'stalled', count: overview.spots.stalled } };
  }
  return { needsAction: false, reason: null };
}
