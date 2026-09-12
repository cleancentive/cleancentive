import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { fetchChfRateOn } from './providers/fx';
import { VendorInvoice } from './vendor-invoice.entity';
import { VENDORS } from './cost.types';

export interface InvoiceCorrection {
  vendor?: string;
  invoiceDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  currency?: string | null;
  amountGross?: number | null;
}

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(VendorInvoice)
    private readonly invoiceRepository: Repository<VendorInvoice>,
  ) {}

  async list() {
    const invoices = await this.invoiceRepository.find({
      order: { invoice_date: 'DESC', created_at: 'DESC' },
      take: 200,
    });

    return invoices.map((invoice) => ({
      id: invoice.id,
      fileName: invoice.file_name,
      vendor: invoice.vendor,
      invoiceDate: invoice.invoice_date,
      periodStart: invoice.period_start,
      periodEnd: invoice.period_end,
      currency: invoice.currency,
      amountGross: invoice.amount_gross === null ? null : Number(invoice.amount_gross),
      amountChf: invoice.amount_chf === null ? null : Number(invoice.amount_chf),
      parseStatus: invoice.parse_status,
      confirmedAt: invoice.confirmed_at,
      parseError:
        invoice.parse_status === 'failed' ? ((invoice.parsed_raw?.error as string) ?? null) : null,
    }));
  }

  /**
   * Applies a steward's correction and marks the row confirmed.
   *
   * A corrected row is authoritative: it is never re-read from the PDF, because
   * a human looking at the invoice beats the model that misread it.
   */
  async correct(id: string, correction: InvoiceCorrection, userId: string) {
    const invoice = await this.invoiceRepository.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (correction.vendor !== undefined) {
      const vendor = correction.vendor.trim().toLowerCase();
      invoice.vendor = (VENDORS as readonly string[]).includes(vendor) ? vendor : 'other';
    }
    if (correction.invoiceDate !== undefined) invoice.invoice_date = correction.invoiceDate;
    if (correction.periodStart !== undefined) invoice.period_start = correction.periodStart;
    if (correction.periodEnd !== undefined) invoice.period_end = correction.periodEnd;
    if (correction.currency !== undefined) {
      invoice.currency = correction.currency ? correction.currency.trim().toUpperCase() : null;
    }
    if (correction.amountGross !== undefined) {
      invoice.amount_gross = correction.amountGross === null ? null : correction.amountGross.toFixed(2);
    }

    await this.reconvert(invoice);

    invoice.parse_status = 'corrected';
    invoice.confirmed_by = userId;
    invoice.confirmed_at = new Date();
    await this.invoiceRepository.save(invoice);

    return invoice;
  }

  /** Confirms a parsed row as-is, without changing any value. */
  async confirm(id: string, userId: string) {
    const invoice = await this.invoiceRepository.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    invoice.confirmed_by = userId;
    invoice.confirmed_at = new Date();
    await this.invoiceRepository.save(invoice);
    return invoice;
  }

  private async reconvert(invoice: VendorInvoice): Promise<void> {
    if (!invoice.amount_gross || !invoice.currency) {
      invoice.amount_chf = null;
      invoice.fx_rate = null;
      return;
    }

    try {
      const rate = await fetchChfRateOn(
        invoice.currency,
        invoice.invoice_date ?? new Date().toISOString().slice(0, 10),
      );
      invoice.fx_rate = rate.toFixed(6);
      invoice.amount_chf = (Number(invoice.amount_gross) * rate).toFixed(2);
    } catch {
      // Leave the previous conversion in place rather than blanking a figure
      // the steward can see, just because Frankfurter is briefly unreachable.
    }
  }
}
