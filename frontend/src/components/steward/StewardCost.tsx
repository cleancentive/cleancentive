import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore, type VendorCost, type VendorInvoiceRow } from '../../stores/adminStore'
import { WeeklyBarChart, type WeeklyBar } from '../WeeklyBarChart'
import { WIKI_URL } from '../../lib/wikiUrl'

const VENDOR_COLORS: Record<string, string> = {
  hetzner: 'var(--blue-500)',
  mistral: 'var(--emerald-500)',
  backblaze: 'var(--amber-500)',
  resend: 'var(--indigo-500)',
  other: 'var(--gray-400)',
}

/** Where a steward downloads each vendor's bill. None of them offers an invoice API. */
const VENDOR_BILLING_URLS: Record<string, string> = {
  hetzner: 'https://accounts.hetzner.com/invoice',
  mistral: 'https://admin.mistral.ai/',
  backblaze: 'https://secure.backblaze.com/billing.htm',
  resend: 'https://resend.com/settings/billing',
}

/** Monthly bills; past this, the newest one on file is probably not the newest one issued. */
const INVOICE_STALE_DAYS = 40

const SCAN_POLL_MS = 2000

const MONTHS_SHOWN = 12

function invoiceDocUrl(docId: string | null): string | null {
  return docId && WIKI_URL ? `${WIKI_URL.replace(/\/$/, '')}/doc/${docId}` : null
}

function isInvoiceMissing(invoiceDate: string | null | undefined, now = Date.now()): boolean {
  if (!invoiceDate) return true
  return now - new Date(invoiceDate).getTime() > INVOICE_STALE_DAYS * 24 * 3600 * 1000
}

/** A chart of nothing but zero bars says less than the sentence it replaces. */
function hasAnyValue(bars: WeeklyBar[]): boolean {
  return bars.some((bar) => bar.segments.some((segment) => segment.value > 0))
}

function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return `${currency ?? ''} ${amount.toFixed(2)}`.trim()
}

function chf(amount: number | null | undefined): string {
  return money(amount, 'CHF')
}

export function StewardCost() {
  const { t } = useTranslation(['steward', 'common'])
  const snapshot = useAdminStore((s) => s.costSnapshot)
  const invoices = useAdminStore((s) => s.costInvoices)
  const fetchCost = useAdminStore((s) => s.fetchCost)
  const fetchCostInvoices = useAdminStore((s) => s.fetchCostInvoices)

  useEffect(() => {
    fetchCost()
    fetchCostInvoices()
  }, [fetchCost, fetchCostInvoices])

  if (!snapshot) {
    return (
      <fieldset className="page-card">
        <legend>{t('cost.legend')}</legend>
        <p className="loading">{t('cost.loading')}</p>
      </fieldset>
    )
  }

  const vendorsSeen = [...new Set(snapshot.invoiceMonths.flatMap((month) => Object.keys(month.byVendor)))]
  const monthBars: WeeklyBar[] = snapshot.invoiceMonths.map((month) => ({
    week: month.month,
    segments: vendorsSeen.map((vendor) => ({
      key: vendor,
      label: vendor,
      value: month.byVendor[vendor] ?? 0,
      color: VENDOR_COLORS[vendor] ?? VENDOR_COLORS.other,
    })),
  }))

  const detectionBars: WeeklyBar[] = snapshot.detectionDaily.map((entry) => ({
    week: entry.day,
    segments: [
      { key: 'detection', label: t('cost.vendor.mistral'), value: entry.costUsd, color: VENDOR_COLORS.mistral },
    ],
  }))

  return (
    <>
      <fieldset className="page-card">
        <legend>{t('cost.legend')}</legend>

        <div className="admin-storage-grid">
          <div className="admin-storage-card">
            <div className="admin-storage-value">{chf(snapshot.projectedMonthChf)}</div>
            <div className="admin-storage-label">{t('cost.projectedMonth')}</div>
          </div>
          <div className="admin-storage-card">
            <div className="admin-storage-value">{chf(snapshot.monthToDateChf)}</div>
            <div className="admin-storage-label">{t('cost.monthToDate')}</div>
          </div>
          {snapshot.vendors.map((vendor) => (
            <div key={vendor.vendor} className="admin-storage-card">
              <div className="admin-storage-value">
                {vendor.status === 'ok' ? chf(vendor.projectedMonthChf) : '—'}
              </div>
              <div className="admin-storage-label">{t(`cost.vendor.${vendor.vendor}`)}</div>
            </div>
          ))}
        </div>

        <p className="project-section-hint">{t('cost.runRateHint')}</p>
        {snapshot.fx.stale && <p className="project-section-hint">{t('cost.fxStale')}</p>}

        <VendorTable
          vendors={snapshot.vendors}
          lastInvoices={snapshot.lastInvoices}
          docUrl={invoiceDocUrl(snapshot.invoiceDocId)}
        />

        <InvoiceScanPanel
          docUrl={invoiceDocUrl(snapshot.invoiceDocId)}
          needingAttention={snapshot.invoicesNeedingAttention}
          onFinished={() => {
            fetchCost()
            fetchCostInvoices()
          }}
        />
      </fieldset>

      <fieldset className="page-card">
        <legend>{t('cost.invoicedLegend')}</legend>
        <p className="project-section-hint">{t('cost.invoicedHint')}</p>
        <WeeklyBarChart
          bars={monthBars}
          maxBars={MONTHS_SHOWN}
          emptyText={t('cost.noInvoices')}
          formatValue={(value) => value.toFixed(0)}
        />
        <div className="weekly-chart-legend">
          {vendorsSeen.map((vendor) => (
            <span key={vendor} className="weekly-chart-legend-item">
              <span
                className="weekly-chart-swatch"
                style={{ backgroundColor: VENDOR_COLORS[vendor] ?? VENDOR_COLORS.other }}
              />
              {t(`cost.vendor.${vendor}`, { defaultValue: vendor })}
            </span>
          ))}
        </div>
      </fieldset>

      <fieldset className="page-card">
        <legend>{t('cost.detectionLegend')}</legend>
        <p className="project-section-hint">{t('cost.detectionHint')}</p>
        {hasAnyValue(detectionBars) ? (
          <WeeklyBarChart
            bars={detectionBars}
            maxBars={31}
            emptyText={t('cost.noDetectionSpend')}
            formatValue={(value) => value.toFixed(2)}
          />
        ) : (
          <p className="insights-empty">{t('cost.noDetectionSpend')}</p>
        )}
        {snapshot.unpricedCalls > 0 && (
          <p className="project-section-hint">
            {t('cost.unpricedCalls', { count: snapshot.unpricedCalls })}
          </p>
        )}
      </fieldset>

      <InvoiceTable invoices={invoices} docUrl={invoiceDocUrl(snapshot.invoiceDocId)} />
    </>
  )
}

function VendorTable({
  vendors,
  lastInvoices,
  docUrl,
}: {
  vendors: VendorCost[]
  lastInvoices: { vendor: string; invoiceDate: string | null; currency: string | null; amountGross: number | null }[]
  docUrl: string | null
}) {
  const { t } = useTranslation(['steward', 'common'])

  return (
    <div className="ops-version-table-wrap">
      <table className="ops-version-table">
        <thead>
          <tr>
            <th>{t('cost.table.vendor')}</th>
            <th>{t('cost.table.thisMonth')}</th>
            <th>{t('cost.table.inChf')}</th>
            <th>{t('cost.table.lastInvoice')}</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((vendor) => {
            const last = lastInvoices.find((invoice) => invoice.vendor === vendor.vendor)
            return (
              <tr key={vendor.vendor}>
                <td>
                  {t(`cost.vendor.${vendor.vendor}`)}
                  {vendor.note && (
                    <div className="admin-storage-label">
                      {t(`cost.note.${vendor.note.key}`, vendor.note.params ?? {})}
                    </div>
                  )}
                  {vendor.error && <div className="admin-storage-label">{vendor.error}</div>}
                </td>
                <td>{money(vendor.projectedMonth, vendor.currency)}</td>
                <td>{chf(vendor.projectedMonthChf)}</td>
                <td>
                  {last ? money(last.amountGross, last.currency) : '—'}
                  {last?.invoiceDate && <div className="admin-storage-label">{last.invoiceDate}</div>}
                  {/* A free-tier vendor sends no bill, so only nag where money is being spent. */}
                  {(vendor.projectedMonth ?? 0) > 0 && isInvoiceMissing(last?.invoiceDate) && (
                    <div className="admin-storage-label cost-invoice-missing">
                      {t('cost.invoiceMissing')}{' '}
                      {VENDOR_BILLING_URLS[vendor.vendor] && (
                        <a href={VENDOR_BILLING_URLS[vendor.vendor]} target="_blank" rel="noopener noreferrer">
                          {t('cost.downloadFrom', { vendor: t(`cost.vendor.${vendor.vendor}`) })}
                        </a>
                      )}
                      {VENDOR_BILLING_URLS[vendor.vendor] && docUrl && ' → '}
                      {docUrl && (
                        <a href={docUrl} target="_blank" rel="noopener noreferrer">
                          {t('cost.attachInWiki')}
                        </a>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function InvoiceScanPanel({
  docUrl,
  needingAttention,
  onFinished,
}: {
  docUrl: string | null
  needingAttention: number
  onFinished: () => void
}) {
  const { t, i18n } = useTranslation(['steward', 'common'])
  const scan = useAdminStore((s) => s.invoiceScan)
  const scanInvoices = useAdminStore((s) => s.scanInvoices)
  const fetchInvoiceScanStatus = useAdminStore((s) => s.fetchInvoiceScanStatus)
  const active = scan?.state === 'queued' || scan?.state === 'running'
  const wasActive = useRef(false)

  // Once on mount, so a scan started by a wiki upload shows up here too.
  useEffect(() => {
    fetchInvoiceScanStatus()
  }, [fetchInvoiceScanStatus])

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void fetchInvoiceScanStatus(), SCAN_POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, fetchInvoiceScanStatus])

  useEffect(() => {
    if (wasActive.current && !active) onFinished()
    wasActive.current = active
  }, [active, onFinished])

  const finishedAt = scan?.finishedAt
    ? new Date(scan.finishedAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <div className="cost-invoice-scan">
      <h3>{t('cost.invoicesLegend')}</h3>
      <p className="project-section-hint">
        {t('cost.scanHint')}{' '}
        {docUrl && (
          <a href={docUrl} target="_blank" rel="noopener noreferrer">
            {t('cost.openBillingDoc')}
          </a>
        )}
      </p>
      <div className="cost-invoice-scan-actions">
        <button type="button" onClick={() => void scanInvoices()} disabled={active}>
          {active ? t('cost.scanning') : t('cost.rescan')}
        </button>
        {needingAttention > 0 && (
          <a href="#invoices" className="admin-storage-label">
            {t('cost.needAttention', { count: needingAttention })}
          </a>
        )}
      </div>

      {active && (
        <div className="cost-invoice-scan-progress" aria-live="polite">
          {scan?.state === 'running' && scan.total > 0 ? (
            <>
              <progress value={scan.done} max={scan.total} />
              <span>
                {t('cost.scanProgress', { done: scan.done, total: scan.total })}
                {scan.current && <span className="admin-storage-label"> · {scan.current}</span>}
              </span>
            </>
          ) : (
            <>
              <progress />
              <span>{scan?.state === 'queued' ? t('cost.scanQueued') : t('cost.scanListing')}</span>
            </>
          )}
        </div>
      )}

      {scan?.state === 'done' && finishedAt && (
        <p className="admin-storage-label">
          {t('cost.lastScan', {
            when: finishedAt,
            ingested: scan.ingested,
            skipped: scan.skipped,
            failed: scan.failed,
          })}
        </p>
      )}
      {scan?.state === 'error' && (
        <p className="admin-storage-label">{t('cost.scanFailed', { error: scan.error ?? '' })}</p>
      )}
    </div>
  )
}

function InvoiceTable({ invoices, docUrl }: { invoices: VendorInvoiceRow[]; docUrl: string | null }) {
  const { t } = useTranslation(['steward', 'common'])
  const correctInvoice = useAdminStore((s) => s.correctInvoice)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <fieldset className="page-card" id="invoices">
      <legend>{t('cost.invoicesLegend')}</legend>
      <p className="project-section-hint">
        {t('cost.invoicesHint')}{' '}
        {(docUrl ?? WIKI_URL) && (
          <a href={docUrl ?? WIKI_URL} target="_blank" rel="noopener noreferrer">
            {t('cost.openBillingDoc')}
          </a>
        )}
      </p>

      {invoices.length === 0 ? (
        <p className="insights-empty">{t('cost.noInvoices')}</p>
      ) : (
        <div className="ops-version-table-wrap">
          <table className="ops-version-table">
            <thead>
              <tr>
                <th>{t('cost.table.date')}</th>
                <th>{t('cost.table.vendor')}</th>
                <th>{t('cost.table.amount')}</th>
                <th>{t('cost.table.inChf')}</th>
                <th>{t('cost.table.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) =>
                editing === invoice.id ? (
                  <InvoiceEditRow
                    key={invoice.id}
                    invoice={invoice}
                    onCancel={() => setEditing(null)}
                    onSave={async (correction) => {
                      await correctInvoice(invoice.id, correction)
                      setEditing(null)
                    }}
                  />
                ) : (
                  <tr key={invoice.id}>
                    <td>{invoice.invoiceDate ?? '—'}</td>
                    <td>
                      {t(`cost.vendor.${invoice.vendor}`, { defaultValue: invoice.vendor })}
                      <div className="admin-storage-label">{invoice.fileName}</div>
                    </td>
                    <td>{money(invoice.amountGross, invoice.currency)}</td>
                    <td>{chf(invoice.amountChf)}</td>
                    <td>
                      {t(`cost.status.${invoice.parseStatus}`)}
                      {invoice.parseError && <div className="admin-storage-label">{invoice.parseError}</div>}
                    </td>
                    <td>
                      <button type="button" onClick={() => setEditing(invoice.id)}>
                        {t('cost.correct')}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  )
}

function InvoiceEditRow({
  invoice,
  onCancel,
  onSave,
}: {
  invoice: VendorInvoiceRow
  onCancel: () => void
  onSave: (correction: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useTranslation(['steward', 'common'])
  const [vendor, setVendor] = useState(invoice.vendor)
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate ?? '')
  const [currency, setCurrency] = useState(invoice.currency ?? '')
  const [amount, setAmount] = useState(invoice.amountGross?.toString() ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        vendor,
        invoiceDate: invoiceDate || null,
        currency: currency || null,
        amountGross: amount === '' ? null : Number(amount),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td>
        <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
      </td>
      <td>
        <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
          {['hetzner', 'mistral', 'backblaze', 'resend', 'other'].map((option) => (
            <option key={option} value={option}>
              {t(`cost.vendor.${option}`, { defaultValue: option })}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          size={8}
        />
        <input
          type="text"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          size={4}
          maxLength={3}
        />
      </td>
      <td colSpan={2}>{t('cost.recalculated')}</td>
      <td>
        <button type="button" onClick={() => void save()} disabled={saving}>
          {t('common:actions.save')}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          {t('common:actions.cancel')}
        </button>
      </td>
    </tr>
  )
}
