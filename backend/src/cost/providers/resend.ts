import { getJson } from '../http';
import { unavailable, type VendorCost } from '../cost.types';

const RESEND_API = 'https://api.resend.com';
/** Resend's published overage rate above a plan's included volume. */
const USD_PER_THOUSAND_OVERAGE = 0.9;

interface MetricsResponse {
  totals?: { sent?: number };
}

export interface ResendPlan {
  /** Monthly plan fee. 0 describes the free tier. */
  monthlyUsd: number;
  /** Emails included in the fee. 3000 describes the free tier. */
  includedEmails: number;
}

export function computeResendCost(sent: number, plan: ResendPlan, daysElapsed: number, daysInMonth: number): VendorCost {
  const projectedSent = daysElapsed > 0 ? Math.round((sent / daysElapsed) * daysInMonth) : sent;
  const overage = (count: number) =>
    Math.max(count - plan.includedEmails, 0) * (USD_PER_THOUSAND_OVERAGE / 1000);

  const lines = [{ label: `Plan fee`, amount: plan.monthlyUsd }];
  const projectedOverage = overage(projectedSent);
  if (projectedOverage > 0) {
    lines.push({ label: `Overage (${projectedSent - plan.includedEmails} emails)`, amount: projectedOverage });
  }

  return {
    vendor: 'resend',
    status: 'ok',
    currency: 'USD',
    projectedMonth: plan.monthlyUsd + projectedOverage,
    monthToDate: plan.monthlyUsd + overage(sent),
    projectedMonthChf: null,
    monthToDateChf: null,
    lines,
    note: { key: 'resend', params: { sent, included: plan.includedEmails } },
    error: null,
  };
}

export async function fetchResendCost(
  apiKey: string | undefined,
  plan: ResendPlan,
  monthStart: Date,
  now: Date,
): Promise<VendorCost> {
  if (!apiKey) {
    return unavailable('resend', new Error('RESEND_API_KEY is not set'));
  }

  try {
    const params = new URLSearchParams({
      start_date: monthStart.toISOString(),
      end_date: now.toISOString(),
      metrics: 'sent',
    });
    const metrics = await getJson<MetricsResponse>(`${RESEND_API}/emails/metrics?${params}`, {
      Authorization: `Bearer ${apiKey}`,
    });

    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    return computeResendCost(metrics.totals?.sent ?? 0, plan, now.getUTCDate(), daysInMonth);
  } catch (error) {
    return unavailable('resend', error);
  }
}
