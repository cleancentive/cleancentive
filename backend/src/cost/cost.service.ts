import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { redisConnection } from '../common/redis-connection';
import { StorageService } from '../storage/storage.service';
import { fetchChfRates, fallbackRates, toChf } from './providers/fx';
import { fetchHetznerCost } from './providers/hetzner';
import { fetchMistralCost } from './providers/mistral';
import { computeBackblazeCost, backblazeUnavailable } from './providers/backblaze';
import { fetchResendCost, type ResendPlan } from './providers/resend';
import { VendorInvoice } from './vendor-invoice.entity';
import {
  REPORTING_CURRENCY,
  type CostSnapshot,
  type FxRates,
  type InvoiceMonth,
  type LastInvoice,
  type VendorCost,
} from './cost.types';

const SNAPSHOT_KEY = 'cost:snapshot';
const SNAPSHOT_TTL_SECONDS = 3600;
const FX_KEY = 'cost:fx';
const FX_TTL_SECONDS = 24 * 3600;

@Injectable()
export class CostService {
  private readonly logger = new Logger(CostService.name);
  private readonly redis = new Redis(redisConnection());
  private readonly hetznerToken = process.env.HETZNER_API_TOKEN;
  private readonly resendApiKey = process.env.RESEND_API_KEY ?? process.env.SMTP_PASS;
  private readonly resendPlan: ResendPlan = {
    monthlyUsd: Number.parseFloat(process.env.RESEND_PLAN_USD_PER_MONTH ?? '0') || 0,
    includedEmails: Number.parseInt(process.env.RESEND_PLAN_INCLUDED_EMAILS ?? '3000', 10) || 3000,
  };

  constructor(
    @InjectRepository(VendorInvoice)
    private readonly invoiceRepository: Repository<VendorInvoice>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {}

  /** The dashboard payload, from cache unless it has gone stale. */
  async getSnapshot(force = false): Promise<CostSnapshot> {
    if (!force) {
      const cached = await this.readCache();
      if (cached) return cached;
    }

    const snapshot = await this.buildSnapshot();
    await this.redis
      .set(SNAPSHOT_KEY, JSON.stringify(snapshot), 'EX', SNAPSHOT_TTL_SECONDS)
      .catch(() => undefined);
    return snapshot;
  }

  private async buildSnapshot(): Promise<CostSnapshot> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const fx = await this.getFxRates();

    const [hetzner, mistral, backblaze, resend] = await Promise.all([
      fetchHetznerCost(this.hetznerToken),
      fetchMistralCost(this.dataSource, now).catch((error) => {
        this.logger.warn(`Metered Mistral spend unavailable: ${error?.message ?? error}`);
        return null;
      }),
      this.storageService
        .getStorageSummary()
        .then((summary) => computeBackblazeCost(summary.totalBytes))
        .catch((error) => backblazeUnavailable(error)),
      fetchResendCost(this.resendApiKey, this.resendPlan, monthStart, now),
    ]);

    const vendors = [hetzner, mistral?.cost, backblaze, resend].filter(
      (cost): cost is VendorCost => !!cost,
    );
    for (const vendor of vendors) {
      vendor.projectedMonthChf = toChf(vendor.projectedMonth, vendor.currency, fx);
      vendor.monthToDateChf = toChf(vendor.monthToDate, vendor.currency, fx);
    }

    const [invoiceMonths, lastInvoices, invoicesNeedingAttention] = await Promise.all([
      this.invoiceMonths(),
      this.lastInvoices(),
      this.countNeedingAttention(),
    ]);

    return {
      generatedAt: now.toISOString(),
      currency: REPORTING_CURRENCY,
      fx,
      projectedMonthChf: sum(vendors.map((v) => v.projectedMonthChf)),
      monthToDateChf: sum(vendors.map((v) => v.monthToDateChf)),
      vendors,
      detectionDaily: mistral?.daily ?? [],
      unpricedCalls: mistral?.unpricedCalls ?? 0,
      invoiceMonths,
      lastInvoices,
      invoicesNeedingAttention,
    };
  }

  /**
   * Live rates, or the last ones we saw.
   *
   * An exchange rate is never a reason for the page not to render, so every
   * failure path still returns numbers — flagged stale so the UI can say so.
   */
  private async getFxRates(): Promise<FxRates> {
    const cached = await this.redis.get(FX_KEY).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as FxRates;
      } catch {
        // Fall through and refetch.
      }
    }

    try {
      const rates = await fetchChfRates();
      await this.redis.set(FX_KEY, JSON.stringify(rates), 'EX', FX_TTL_SECONDS).catch(() => undefined);
      return rates;
    } catch (error) {
      this.logger.warn(`FX rates unavailable, using fallback: ${error instanceof Error ? error.message : error}`);
      return fallbackRates();
    }
  }

  /** Real invoiced spend by calendar month, oldest first. */
  private async invoiceMonths(): Promise<InvoiceMonth[]> {
    const rows: { month: string; vendor: string; total: string }[] = await this.invoiceRepository.query(
      `SELECT TO_CHAR(date_trunc('month', COALESCE(period_start, invoice_date)), 'YYYY-MM') AS month,
              vendor,
              SUM(amount_chf) AS total
       FROM vendor_invoices
       WHERE amount_chf IS NOT NULL AND COALESCE(period_start, invoice_date) IS NOT NULL
       GROUP BY 1, 2
       ORDER BY 1`,
    );

    const byMonth = new Map<string, InvoiceMonth>();
    for (const row of rows) {
      const entry = byMonth.get(row.month) ?? { month: row.month, byVendor: {}, totalChf: 0 };
      const amount = Number(row.total);
      entry.byVendor[row.vendor] = (entry.byVendor[row.vendor] ?? 0) + amount;
      entry.totalChf += amount;
      byMonth.set(row.month, entry);
    }

    return [...byMonth.values()];
  }

  /** The newest invoice per vendor, so the computed figure has something to face. */
  private async lastInvoices(): Promise<LastInvoice[]> {
    const rows: {
      vendor: string;
      invoice_date: string | null;
      currency: string | null;
      amount_gross: string | null;
      amount_chf: string | null;
    }[] = await this.invoiceRepository.query(
      `SELECT DISTINCT ON (vendor) vendor, invoice_date, currency, amount_gross, amount_chf
       FROM vendor_invoices
       WHERE parse_status <> 'failed'
       ORDER BY vendor, invoice_date DESC NULLS LAST`,
    );

    return rows.map((row) => ({
      vendor: row.vendor,
      invoiceDate: row.invoice_date,
      currency: row.currency,
      amountGross: row.amount_gross === null ? null : Number(row.amount_gross),
      amountChf: row.amount_chf === null ? null : Number(row.amount_chf),
    }));
  }

  private async countNeedingAttention(): Promise<number> {
    return this.invoiceRepository
      .createQueryBuilder('invoice')
      .where(`invoice.parse_status = 'failed' OR invoice.confirmed_at IS NULL`)
      .getCount();
  }

  private async readCache(): Promise<CostSnapshot | null> {
    try {
      const cached = await this.redis.get(SNAPSHOT_KEY);
      return cached ? (JSON.parse(cached) as CostSnapshot) : null;
    } catch {
      return null;
    }
  }

  async invalidate(): Promise<void> {
    await this.redis.del(SNAPSHOT_KEY).catch(() => undefined);
  }
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
