import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { UserEmail } from '../user/user-email.entity';
import { resolveNotificationRecipients } from '../user/notification-recipients';
import { EmailService } from '../email/email.service';
import { emailStrings } from '../email/email.i18n';
import { redisConnection } from '../common/redis-connection';
import { AdminService } from '../admin/admin.service';
import { decideAlert, type ActionableState, type AlertDecision, type AlertState } from '../admin/alert-decision';
import { CostService } from './cost.service';
import { InvoiceIngestService } from './invoice-ingest.service';
import type { CostSnapshot } from './cost.types';

export interface CostAlertReason {
  projectedChf: number;
  ceilingChf: number;
}

/**
 * Identity of the condition. Rounded to the franc so ordinary drift in the
 * detection projection does not read as a new problem every single day.
 */
export function costReasonKey(reason: CostAlertReason | null): string {
  return reason ? `over:${Math.round(reason.projectedChf)}` : '';
}

export function describeCostState(snapshot: CostSnapshot, ceilingChf: number): ActionableState<CostAlertReason> {
  if (ceilingChf <= 0 || snapshot.projectedMonthChf <= ceilingChf) {
    return { needsAction: false, reason: null };
  }
  return {
    needsAction: true,
    reason: { projectedChf: snapshot.projectedMonthChf, ceilingChf },
  };
}

@Injectable()
export class CostAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CostAlertService.name);
  // Its own queue, not the shared alert queue: DetectionAlertService clears every
  // repeatable on `cleancentive-alerts` at boot, which would race ours away.
  private readonly queueName = 'cleancentive-cost';
  private readonly stateKey = 'ops:alert:cost:state';
  private readonly checkPattern = process.env.COST_ALERT_CRON || '0 6 * * *';
  private readonly ceilingChf = Number.parseFloat(process.env.COST_ALERT_MONTHLY_CHF ?? '0') || 0;
  private readonly reAlertMs =
    parseInt(process.env.COST_ALERT_REPEAT_HOURS || '168', 10) * 60 * 60 * 1000;
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly redis: Redis;

  constructor(
    @InjectRepository(UserEmail)
    private readonly userEmailRepository: Repository<UserEmail>,
    private readonly adminService: AdminService,
    private readonly costService: CostService,
    private readonly invoiceIngest: InvoiceIngestService,
    private readonly emailService: EmailService,
  ) {
    this.redis = new Redis(redisConnection());
    this.queue = new Queue(this.queueName, { connection: redisConnection() });
    this.worker = new Worker(
      this.queueName,
      async (job) => {
        if (job.name === 'cost-daily') {
          await this.invoiceIngest.scan();
          await this.check();
        }
        if (job.name === 'invoice-scan') {
          await this.invoiceIngest.scan();
          await this.costService.invalidate();
        }
      },
      { connection: redisConnection(), concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Cost job ${job?.name} failed: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    for (const job of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    if (process.env.COST_ALERT_ENABLED === 'false') {
      this.logger.log('Cost checks disabled (COST_ALERT_ENABLED=false)');
      return;
    }

    await this.queue.add('cost-daily', {}, {
      repeat: { pattern: this.checkPattern },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.logger.log(`Cost check registered: ${this.checkPattern}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.redis?.disconnect();
  }

  /**
   * A wiki document changed. If it is one we read invoices from, look again.
   *
   * The document set is resolved inside the scan rather than here, because the
   * billing document can gain children at any time and this listener should not
   * need to know about them.
   */
  @OnEvent('outline.document-changed')
  async onOutlineDocumentChanged(payload: { documentId: string }): Promise<void> {
    if (!payload?.documentId) return;
    await this.requestInvoiceScan().catch((error) => {
      this.logger.warn(`Could not queue an invoice scan: ${error instanceof Error ? error.message : error}`);
    });
  }

  /**
   * Asks for an invoice scan without waiting for one.
   *
   * A fixed jobId plus a short delay collapses the several `documents.update`
   * events Outline emits for a single upload into one scan.
   */
  async requestInvoiceScan(): Promise<void> {
    await this.queue.add('invoice-scan', {}, {
      jobId: 'invoice-scan-pending',
      delay: 20_000,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async check(): Promise<AlertDecision<CostAlertReason>> {
    const snapshot = await this.costService.getSnapshot(true);
    const current = describeCostState(snapshot, this.ceilingChf);

    const previous = await this.readState();
    const decision = decideAlert(previous, current, Date.now(), this.reAlertMs, costReasonKey);

    if (!decision.send) return decision;

    await this.notify(decision, snapshot);
    await this.redis.set(
      this.stateKey,
      JSON.stringify({
        needsAction: current.needsAction,
        reasonKey: costReasonKey(current.reason),
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

  private async notify(
    decision: Extract<AlertDecision<CostAlertReason>, { send: true }>,
    snapshot: CostSnapshot,
  ): Promise<void> {
    const adminIds = await this.adminService.getAdminUserIds();
    const recipients = await resolveNotificationRecipients(this.userEmailRepository, adminIds);
    if (recipients.length === 0) {
      this.logger.warn('Running costs need attention but no steward has a login email configured');
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/steward/cost`;
    const recovered = decision.kind === 'recovered';
    const projected = formatChf(snapshot.projectedMonthChf);
    const ceiling = formatChf(this.ceilingChf);
    const breakdown = snapshot.vendors
      .filter((vendor) => vendor.projectedMonthChf !== null)
      .map((vendor) => `- ${vendor.vendor}: ${formatChf(vendor.projectedMonthChf ?? 0)}`);

    await this.emailService.sendCommunityMessage(recipients, null, (locale) => {
      const strings = emailStrings(locale).costAlert;
      return {
        subject: recovered ? strings.recoveredSubject : strings.subject,
        preheader: recovered ? strings.recoveredPreheader : strings.preheader,
        title: recovered ? strings.recoveredTitle : strings.title,
        body: [
          recovered ? strings.recoveredIntro(projected, ceiling) : strings.intro(projected, ceiling),
          '',
          `**${strings.breakdownLabel}:**`,
          ...breakdown,
          '',
          strings.action(link),
        ].join('\n'),
        disclosure: strings.disclosure,
      };
    });

    this.logger.log(`Cost alert (${decision.kind}) sent to ${recipients.length} steward(s)`);
  }
}

function formatChf(amount: number): string {
  return `CHF ${amount.toFixed(2)}`;
}
