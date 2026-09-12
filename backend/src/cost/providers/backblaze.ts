import { unavailable, type VendorCost } from '../cost.types';

/** Backblaze B2 list price, https://www.backblaze.com/cloud-storage/pricing */
const USD_PER_TB_MONTH = 6;
const BYTES_PER_TB = 1_000_000_000_000;

/**
 * B2 has no bucket-size endpoint — neither the native API nor the S3 one — and
 * working it out would mean paging every file in the bucket. We already track
 * exactly the bytes we put there, so we price those instead.
 *
 * That covers the app bucket only. The wiki bucket is on the same invoice and
 * is not counted here, which is why the page says so and why the parsed B2
 * invoice sitting next to this number is worth having.
 */
export function computeBackblazeCost(totalBytes: number): VendorCost {
  const terabytes = totalBytes / BYTES_PER_TB;
  const monthly = terabytes * USD_PER_TB_MONTH;

  return {
    vendor: 'backblaze',
    status: 'ok',
    currency: 'USD',
    projectedMonth: monthly,
    monthToDate: monthly,
    projectedMonthChf: null,
    monthToDateChf: null,
    lines: [{ label: `Spot images (${terabytes.toFixed(3)} TB)`, amount: monthly }],
    note: { key: 'backblaze' },
    error: null,
  };
}

export function backblazeUnavailable(error: unknown): VendorCost {
  return unavailable('backblaze', error);
}
