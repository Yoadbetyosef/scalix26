'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Check, ExternalLink, Search, X } from 'lucide-react'
import { coverage } from '@/lib/invoices/allocate'
import { MIN_COVERAGE, type InvoiceLine, type ShipmentDetail } from '@/lib/invoices/types'
import { landedCost } from '@/lib/catalog/cost-math'

// The approval screen.
//
// Everything on this page exists so the owner can answer one question before anything is written:
// is this allocation resting on enough of the invoice to be worth applying? The coverage line is the
// centre of it — freight is spread across MATCHED lines only, so at low coverage the matched products
// absorb the freight of goods nobody identified, and the right response is to go match them rather
// than to accept the number.

const money = (n: number | null, ccy: string) =>
  n === null ? '—' : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

const METHOD: Record<string, string> = {
  exact_sku: 'SKU matched exactly',
  normalized_sku: 'SKU matched once punctuation is ignored',
  name_trigram: 'Matched on name',
  manual: 'You chose this',
}

export default function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [d, setD] = useState<ShipmentDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [confirmReapply, setConfirmReapply] = useState(false)

  // Loaded once here; every later change arrives as the full shipment in a PATCH/POST response, so
  // there is no second fetcher to keep in step.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/invoices/shipments/${id}`)
        const j = await r.json()
        if (!alive) return
        if (!r.ok) throw new Error(j.error || 'Could not load this shipment.')
        setD(j)
      } catch (e) { if (alive) setErr((e as Error).message) }
    })()
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    // Minted per view and short-lived; the bucket is private and the bytes never reach the browser any
    // other way.
    fetch(`/api/invoices/shipments/${id}/file`).then((r) => r.json()).then((j) => setFileUrl(j.url ?? null)).catch(() => {})
  }, [id])

  const cov = useMemo(() => coverage(d?.lines ?? []), [d])
  const below = cov.ratio < MIN_COVERAGE

  async function patchLine(lineId: string, body: { productId?: string | null; skip?: boolean }) {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/invoices/lines/${lineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not update that line.')
      // The whole shipment comes back, not the line: changing one match moves every other line's share.
      setD(j)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function apply(opts: { override?: boolean; reapply?: boolean } = {}) {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/invoices/shipments/${id}/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not apply this shipment.')
      setD(j); setConfirmReapply(false)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (err && !d) return <p className="mx-auto max-w-5xl px-4 py-8 text-sm text-red-700">{err}</p>
  if (!d) return <p className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted">Loading…</p>

  const { shipment, invoice, lines, settings } = d
  const ccy = shipment.currency
  const charges = shipment.freightTotal + shipment.dutiesTotal + shipment.otherTotal
  const applied = shipment.status === 'applied'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/landed-cost" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Shipments
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{shipment.reference || invoice.fileName}</h1>
          <p className="mt-1 text-sm text-muted">
            {[
              invoice.supplierName,
              invoice.invoiceNumber && `Invoice ${invoice.invoiceNumber}`,
              invoice.invoiceDate && new Date(invoice.invoiceDate).toLocaleDateString(),
              invoice.pageCount && `${invoice.pageCount} page${invoice.pageCount === 1 ? '' : 's'}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noreferrer"
            className="flex h-10 items-center gap-2 rounded-lg border border-hairline-strong px-3 text-sm font-medium text-ink hover:bg-sunken/50">
            <ExternalLink className="h-4 w-4" /> View invoice
          </a>
        )}
      </header>

      {invoice.status === 'failed' && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {invoice.extractionError || 'This invoice could not be read.'}
        </p>
      )}
      {err && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {/* The charges being spread. Editable because a forwarder's bill often arrives separately from
          the invoice, and the owner is the one holding both. */}
      <section className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-hairline-strong bg-white p-4 sm:grid-cols-4">
        {/* key carries the value so a server-side change remounts the input with fresh state — see Charge. */}
        <Charge key={`freight-${shipment.freightTotal}`} label={`Freight (${ccy})`} value={shipment.freightTotal} id={id} field="freightTotal" disabled={applied || busy} onSaved={setD} />
        <Charge key={`duties-${shipment.dutiesTotal}`} label={`Duty (${ccy})`} value={shipment.dutiesTotal} id={id} field="dutiesTotal" disabled={applied || busy} onSaved={setD} />
        <Charge key={`other-${shipment.otherTotal}`} label={`Other (${ccy})`} value={shipment.otherTotal} id={id} field="otherTotal" disabled={applied || busy} onSaved={setD} />
        <div>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">To spread</span>
          <span className="text-base font-semibold text-ink">{money(charges, ccy)}</span>
        </div>
      </section>

      {/* THE coverage line. Not a footnote: it is what makes spreading freight over matched lines only
          an honest choice rather than a silent one. */}
      <section className={`mb-4 rounded-xl border px-4 py-3 ${below ? 'border-amber-200 bg-amber-50' : 'border-hairline-strong bg-white'}`}>
        <p className={`text-sm ${below ? 'text-amber-900' : 'text-ink'}`}>
          <strong>{money(charges, ccy)}</strong>
          {` spread across ${cov.matchedLines} of ${lines.length} lines — `}
          <strong>{`${(cov.ratio * 100).toFixed(0)}%`}</strong>
          {` of the invoice's value.`}
        </p>
        {cov.unmatchedLines > 0 && (
          <p className={`mt-1 text-sm ${below ? 'text-amber-800' : 'text-muted'}`}>
            {`${cov.unmatchedLines} line${cov.unmatchedLines === 1 ? '' : 's'} unmatched (${money(cov.unmatchedValue, ccy)})`}
            {cov.skippedLines > 0 && `, ${cov.skippedLines} skipped on purpose`}
            {below
              ? '. Their share of the freight lands on the matched products instead, so those costs will be overstated. Match them below before applying.'
              : '. Their share of the freight lands on the matched products instead.'}
          </p>
        )}
        <p className="mt-2 text-xs text-subtle">
          Freight is divided by line value — a proxy for weight, which the invoice does not carry.
        </p>
      </section>

      <ul className="divide-y divide-hairline rounded-xl border border-hairline-strong bg-white">
        {lines.map((l) => (
          <Line key={l.id} line={l} ccy={ccy} baseCurrency={settings.baseCurrency} markup={settings.markupPercent}
            invoiceCurrency={invoice.currency} disabled={applied || busy} onPatch={patchLine} />
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {applied ? (
          <>
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" /> Applied {shipment.appliedAt && new Date(shipment.appliedAt).toLocaleString()}
            </p>
            {/* Never silent. Re-applying overwrites what the first apply wrote, and the button says so
                before it does anything. */}
            {confirmReapply ? (
              <span className="flex items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {`This overwrites the shipping and duty on all ${cov.matchedLines} matched products with the figures above.`}
                <button type="button" onClick={() => apply({ override: below, reapply: true })} disabled={busy}
                  className="font-semibold underline">Overwrite</button>
                <button type="button" onClick={() => setConfirmReapply(false)} className="underline">Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmReapply(true)}
                className="h-10 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-ink hover:bg-sunken/50">
                Apply again
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" onClick={() => apply()} disabled={busy || below || cov.matchedLines === 0 || invoice.status === 'failed'}
              className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Applying…' : `Apply to ${cov.matchedLines} product${cov.matchedLines === 1 ? '' : 's'}`}
            </button>
            {below && cov.matchedLines > 0 && (
              // The override exists because sometimes the unmatched lines really are things the
              // business does not stock. It is an act, never a default.
              <button type="button" onClick={() => apply({ override: true })} disabled={busy}
                className="text-sm font-medium text-amber-800 underline">
                Apply anyway, at {(cov.ratio * 100).toFixed(0)}% coverage
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One editable charge. Saved on blur, then the whole allocation comes back recomputed.
 *
 * The server value seeds local typing state exactly once. Re-syncing it with an effect would be state
 * derived from a prop — invalid React, and it would also fight the owner's cursor mid-edit. The parent
 * passes a `key` that includes the value, so a change from the server remounts this with a fresh
 * initial state instead.
 */
function Charge({ label, value, id, field, disabled, onSaved }: {
  label: string; value: number; id: string; field: string; disabled: boolean
  onSaved: (d: ShipmentDetail) => void
}) {
  const [v, setV] = useState(String(value || ''))

  const save = async () => {
    const n = Number(v.trim() || 0)
    if (!Number.isFinite(n) || n < 0 || n === value) return
    const r = await fetch(`/api/invoices/shipments/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: n }),
    })
    if (r.ok) onSaved(await r.json())
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
      <input className="h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent disabled:bg-sunken/60"
        inputMode="decimal" value={v} placeholder="0" disabled={disabled}
        onChange={(e) => setV(e.target.value)} onBlur={save} />
    </label>
  )
}

function Line({ line, ccy, baseCurrency, markup, invoiceCurrency, disabled, onPatch }: {
  line: InvoiceLine; ccy: string; baseCurrency: string; markup: number; invoiceCurrency: string
  disabled: boolean
  onPatch: (id: string, body: { productId?: string | null; skip?: boolean }) => void
}) {
  const [picking, setPicking] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; sku: string | null }>>([])

  const openPicker = async () => {
    setPicking(true)
    const r = await fetch(`/api/invoices/lines/${line.id}`)
    if (r.ok) setSuggestions((await r.json()).suggestions ?? [])
  }

  // What this line will do to the product's landed cost. Computed with the same function the cost card
  // and the generated column use, so the figure shown here is the figure the database will hold.
  //
  // Unit cost only counts when the invoice is already in the tenant's base currency: nothing here
  // converts anything, and no FX rate is stored anywhere, because a stored rate is a wrong rate.
  const unitInBase = invoiceCurrency.toUpperCase() === baseCurrency.toUpperCase()
  const unit = line.quantity && line.quantity > 0 ? line.extended / line.quantity : null
  const preview = unitInBase ? landedCost(unit, line.allocatedFreight, line.allocatedDuties, markup) : null

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{line.description || `Line ${line.lineNo}`}</p>
          <p className="mt-0.5 text-xs text-muted">
            {[
              line.sku && `SKU ${line.sku}`,
              line.quantity !== null && `${line.quantity} ×`,
              line.unitPrice !== null && money(line.unitPrice, ccy),
              `= ${money(line.extended, ccy)}`,
            ].filter(Boolean).join(' · ')}
          </p>

          {line.status === 'matched' && (
            <p className="mt-1 text-xs">
              <span className="text-emerald-700">→ {line.productName || 'product'}</span>
              {line.productSku && <span className="text-muted"> ({line.productSku})</span>}
              <span className="text-subtle">
                {` · ${METHOD[line.matchMethod ?? ''] ?? 'Matched'}`}
                {line.matchMethod === 'name_trigram' && line.matchConfidence !== null && ` (${Math.round(line.matchConfidence * 100)}%)`}
              </span>
            </p>
          )}
          {line.status === 'unmatched' && <p className="mt-1 text-xs text-amber-700">Not matched to a product</p>}
          {line.status === 'skipped' && <p className="mt-1 text-xs text-subtle">Skipped — takes no share of the freight</p>}
        </div>

        <div className="shrink-0 text-right">
          {line.status === 'matched' && (
            <>
              <p className="text-xs text-subtle">Takes</p>
              <p className="text-sm font-medium text-ink">{money(line.allocatedFreight + line.allocatedDuties, ccy)}</p>
              {preview !== null && <p className="text-xs text-muted">Lands at {money(preview, baseCurrency)}</p>}
            </>
          )}
          {!disabled && (
            <div className="mt-1 flex justify-end gap-2 text-xs">
              <button type="button" onClick={openPicker} className="text-accent underline">
                {line.status === 'matched' ? 'Change' : 'Match'}
              </button>
              {line.status !== 'skipped' && (
                <button type="button" onClick={() => onPatch(line.id, { skip: true })} className="text-muted underline">Skip</button>
              )}
              {line.status === 'skipped' && (
                <button type="button" onClick={() => onPatch(line.id, { skip: false, productId: null })} className="text-muted underline">Un-skip</button>
              )}
            </div>
          )}
        </div>
      </div>

      {picking && (
        <div className="mt-3 rounded-lg border border-hairline bg-sunken/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-subtle"><Search className="h-3 w-3" /> Closest products</span>
            <button type="button" onClick={() => setPicking(false)}><X className="h-4 w-4 text-muted" /></button>
          </div>
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted">Nothing in the catalogue looks close. Add the product first, then match this line.</p>
          ) : (
            <ul className="space-y-1">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button type="button"
                    onClick={() => { onPatch(line.id, { productId: s.id }); setPicking(false) }}
                    className="w-full rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-white">
                    {s.name}{s.sku && <span className="text-muted"> ({s.sku})</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
