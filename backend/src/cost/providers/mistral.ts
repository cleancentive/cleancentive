import type { DataSource } from 'typeorm';
import type { VendorCost } from '../cost.types';

export interface DetectionUsage {
  cost: VendorCost;
  daily: { day: string; costUsd: number }[];
  unpricedCalls: number;
}

/**
 * Mistral spend, metered by us.
 *
 * `GET /v1/admin/usage` is Enterprise-only, so the token counts every response
 * carries are the only source we have. Each llm_usage row was priced when it
 * was written, which is why a price change never rewrites a past month.
 */
export async function fetchMistralCost(dataSource: DataSource, now: Date): Promise<DetectionUsage> {
  const rows: { day: string; cost: string | null; unpriced: number }[] = await dataSource.query(
    `SELECT TO_CHAR(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            SUM(cost_usd) AS cost,
            COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced
     FROM llm_usage
     WHERE created_at >= date_trunc('month', NOW())
     GROUP BY 1
     ORDER BY 1`,
  );

  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate();

  const daily = listDaysOfMonth(now).map((day) => ({
    day,
    costUsd: Number(rows.find((row) => row.day === day)?.cost ?? 0),
  }));

  const monthToDate = daily.reduce((sum, entry) => sum + entry.costUsd, 0);
  const unpricedCalls = rows.reduce((sum, row) => sum + Number(row.unpriced), 0);

  return {
    cost: {
      vendor: 'mistral',
      status: 'ok',
      currency: 'USD',
      // Straight-line from what the month has cost so far. Detection volume
      // tracks how much people are out picking, so this is a guide, not a promise.
      projectedMonth: daysElapsed > 0 ? (monthToDate / daysElapsed) * daysInMonth : monthToDate,
      monthToDate,
      projectedMonthChf: null,
      monthToDateChf: null,
      lines: [{ label: 'Detection and identification', amount: monthToDate }],
      note:
        unpricedCalls > 0
          ? { key: 'mistralUnpriced', params: { count: unpricedCalls } }
          : { key: 'mistral' },
      error: null,
    },
    daily,
    unpricedCalls,
  };
}

/** Every day of the current month up to today, so a quiet day renders as zero. */
export function listDaysOfMonth(now: Date): string[] {
  const days: string[] = [];
  for (let day = 1; day <= now.getUTCDate(); day++) {
    days.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day)).toISOString().slice(0, 10));
  }
  return days;
}
