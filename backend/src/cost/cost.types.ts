export const VENDORS = ['hetzner', 'mistral', 'backblaze', 'resend'] as const;
export type Vendor = (typeof VENDORS)[number];

/** The currency every vendor total is converted into for the combined figure. */
export const REPORTING_CURRENCY = 'CHF';

export interface CostLine {
  label: string;
  amount: number;
}

export interface VendorCost {
  vendor: Vendor;
  status: 'ok' | 'unavailable';
  currency: string | null;
  /** What the whole calendar month is expected to cost, in the vendor's currency. */
  projectedMonth: number | null;
  /** Spent so far this month. Equal to the projection for flat-rate vendors. */
  monthToDate: number | null;
  projectedMonthChf: number | null;
  monthToDateChf: number | null;
  lines: CostLine[];
  /** Anything the number does not say for itself, as a key the UI translates. */
  note: CostNote | null;
  error: string | null;
}

/**
 * A note is a key plus its values rather than a sentence: the steward page is
 * served in three languages and the backend has no business picking one.
 */
export interface CostNote {
  key: string;
  params?: Record<string, string | number>;
}

export interface FxRates {
  /** Multiply an amount in this currency by `rates[currency]` to get CHF. */
  rates: Record<string, number>;
  date: string;
  /** True when we are serving a cached or fallback rate because the fetch failed. */
  stale: boolean;
}

export interface InvoiceMonth {
  month: string;
  byVendor: Partial<Record<string, number>>;
  totalChf: number;
}

export interface LastInvoice {
  vendor: string;
  invoiceDate: string | null;
  currency: string | null;
  amountGross: number | null;
  amountChf: number | null;
}

export interface CostSnapshot {
  generatedAt: string;
  currency: typeof REPORTING_CURRENCY;
  fx: FxRates;
  projectedMonthChf: number;
  monthToDateChf: number;
  vendors: VendorCost[];
  /** Metered detection spend for the current month, by day, in USD. */
  detectionDaily: { day: string; costUsd: number }[];
  /** Calls we recorded but could not price, because the model has no published rate. */
  unpricedCalls: number;
  /** Real invoiced spend by month, from the PDFs in the wiki. */
  invoiceMonths: InvoiceMonth[];
  /** The most recent invoice per vendor, to check our arithmetic against. */
  lastInvoices: LastInvoice[];
  invoicesNeedingAttention: number;
}

export function unavailable(vendor: Vendor, error: unknown): VendorCost {
  return {
    vendor,
    status: 'unavailable',
    currency: null,
    projectedMonth: null,
    monthToDate: null,
    projectedMonthChf: null,
    monthToDateChf: null,
    lines: [],
    note: null,
    error: error instanceof Error ? error.message : String(error),
  };
}
