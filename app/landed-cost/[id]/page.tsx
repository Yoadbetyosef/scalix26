'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Check, ExternalLink, Search, X } from 'lucide-react'
import { readJson, type HttpError } from '@/lib/http/read-response'
import { coverage, unitShare } from '@/lib/invoices/allocate'
import { divergenceHeadline, divergenceSentence } from '@/lib/invoices/divergence'
import { MIN_COVERAGE, type InvoiceLine, type ShipmentDetail } from '@/lib/invoices/types'
import { landedCost } from '@/lib/catalog/cost-math'

// The approval screen.
//
// Everything here exists so the owner can answer one question before anything is written: is this
// allocation resting on enough of the invoice to be worth applying? The coverage line is the centre of
// it — freight is spread across MATCHED lines only, so at low coverage the matched products absorb the
// freight of goods nobody identified.
//
// ── FOUR NUMBERS IN THREE CURRENCIES, ON ONE TABLE ──────────────────────────────────────────────────
//
// This is the most dangerous surface in the feature, because four different things meet on it:
//
//   line values      in the INVOICE's currency   (EUR, off the supplier's paper)
//   the rate         a number the owner types    (EUR → USD, paid on this invoice)
//   freight & duty   in BASE currency            (USD, off the forwarder's separate bill)
//   the result       in BASE currency            (USD, what lands on the product)
//
// So every figure on this page is labelled with its currency, always, even where it looks obvious.
// An unlabelled number between a EUR column and a USD column is exactly where a wrong one hides.

const money = (n: number | null, ccy: string) =>
  n === null ? '—' : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

const METHOD: Record<string, string> = {
  exact_sku: 'SKU matched exactly',
  normalized_sku: 'SKU matched once punctuation is ignored',
  name_trigram: 'Matched on name',
  manual: 'You chose this',
  created: 'Created from this line',
}

export default function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [d, setD] = useState<ShipmentDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [confirmReapply, setConfirmReapply] = useState(false)
  const [confirmDivergence, setConfirmDivergence] = useState(false)
  // Lines the owner has ticked to become products, and any name they retyped first. Kept here rather
  // than per-row so "create these six" is one request and one recomputed allocation.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const j = await readJson<ShipmentDetail>(await fetch(`/api/invoices/shipments/${id}`), 'Could not load this shipment.')
        if (!alive) return
        setD(j)
      } catch (e) { if (alive) setErr((e as Error).message) }
    })()
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    fetch(`/api/invoices/shipments/${id}/file`).then((r) => r.json()).then((j) => setFileUrl(j.url ?? null)).catch(() => {})
  }, [id])

  /** Pull the shipment again. Used when the server saw something this tab did not. */
  async function reload() {
    try {
      setD(await readJson<ShipmentDetail>(await fetch(`/api/invoices/shipments/${id}`), 'Could not reload this shipment.'))
    } catch { /* the caller is already reporting why it reloaded */ }
  }

  const cov = useMemo(() => coverage(d?.lines ?? []), [d])
  const below = cov.ratio < MIN_COVERAGE

  async function patchLine(lineId: string, body: { productId?: string | null; skip?: boolean }) {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/invoices/lines/${lineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      // The whole shipment comes back, not the line: changing one match moves every other line's share.
      setD(await readJson<ShipmentDetail>(r, 'Could not update that line.'))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function createProducts() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/invoices/lines/create-products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineIds: [...picked], names }),
      })
      const j = await readJson<ShipmentDetail>(r, 'Could not create those products.')
      setD(j); setPicked(new Set()); setNames({})
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function apply(opts: { override?: boolean; reapply?: boolean; acknowledgeDivergence?: boolean } = {}) {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/invoices/shipments/${id}/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts),
      })
      const j = await readJson<ShipmentDetail>(r, 'Could not apply this shipment.')
      setD(j); setConfirmReapply(false); setConfirmDivergence(false)
    } catch (e) {
      // The server recomputes divergence from the database at the moment of the write, so it can flag
      // something this tab never rendered — a cost edited elsewhere while this page sat open. Reload
      // and ask, rather than reporting it as a failure the owner cannot act on. readJson carries the
      // status and body on the Error so this stays a branch on shape, not on message text.
      const h = e as HttpError
      if (h.status === 409 && h.body?.needsAcknowledgement) {
        await reload(); setConfirmDivergence(true)
        setErr('Costs changed while this page was open — see below before applying.')
      } else setErr(h.message)
    } finally { setBusy(false) }
  }

  if (err && !d) return <p className="mx-auto max-w-5xl px-4 py-8 text-sm text-red-700">{err}</p>
  if (!d) return <p className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted">Loading…</p>

  const { shipment, invoice, lines, divergences, settings } = d
  const base = settings.baseCurrency              // what the cost columns are kept in — USD
  const inv = invoice.currency                    // what the supplier's paper is written in — EUR
  const foreign = inv.toUpperCase() !== base.toUpperCase()

  const charges = shipment.freightTotal + shipment.dutiesTotal + shipment.otherTotal
  const applied = shipment.status === 'applied'
  const reorders = lines.filter((l) => l.status === 'matched' && l.priorShipment)
  const shared = lines.filter((l) => (l.sharesProductWith ?? 0) > 0)
  const creatable = lines.filter((l) => l.status === 'unmatched')
  const collapsing = divergences.filter((x) => x.nextMargin !== null && x.previousMargin !== null && x.nextMargin < x.previousMargin)

  // Belt-and-braces. The shipment's currency is now always the tenant's base — freight comes from the
  // forwarder in base currency and is never seeded from the invoice — so this should not fire. It is
  // kept because the RPC enforces the same thing, and a screen that cannot show a state the database
  // can refuse would leave the owner reading an error with no matching field.
  const wrongFreightCurrency = charges > 0 && shipment.currency.toUpperCase() !== base.toUpperCase()

  // A foreign invoice cannot be applied without the rate that was paid on it. Refused rather than
  // skipped: quietly leaving cost_primary unwritten produces a product carrying this shipment's freight
  // with no landed cost and no margin at all, and nothing on any screen saying why.
  const rateMissing = foreign && !invoice.exchangeRate
  const blocked = below || wrongFreightCurrency || rateMissing || cov.matchedLines === 0 || invoice.status === 'failed'

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
              `Invoiced in ${inv}`,
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
      {invoice.matchNote && (
        <p className="mb-4 rounded-lg bg-sunken/70 px-4 py-3 text-sm text-subtle">{invoice.matchNote}</p>
      )}

      {/* THE TWO DOCUMENTS, kept visibly apart because they are two documents.
          Left: the supplier's invoice and the rate paid on it. Right: the forwarder's bill. */}
      <section className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-hairline-strong bg-white p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">
            {`Supplier invoice · ${inv}`}
          </h2>
          {foreign ? (
            <>
              <Rate key={`rate-${invoice.exchangeRate ?? ''}`} id={id} from={inv} to={base}
                value={invoice.exchangeRate} disabled={applied || busy} onSaved={setD} />
              <p className="mt-2 text-xs text-subtle">
                {`The rate you actually paid on this invoice. It converts the line values below into ${base} — `}
                {`and nothing else. Freight is never multiplied by it: that arrives from your forwarder already in ${base}.`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">{`Invoiced in ${base}, so nothing needs converting.`}</p>
          )}
          {invoice.grandTotal !== null && (
            <p className="mt-3 text-sm text-muted">{`Invoice total ${money(invoice.grandTotal, inv)}`}</p>
          )}
        </div>

        <div className="rounded-xl border border-hairline-strong bg-white p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">
            {`Freight forwarder · ${base}`}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Charge key={`freight-${shipment.freightTotal}`} label="Freight" value={shipment.freightTotal} id={id} field="freightTotal" ccy={base} disabled={applied || busy} onSaved={setD} />
            <Charge key={`duties-${shipment.dutiesTotal}`} label="Duty" value={shipment.dutiesTotal} id={id} field="dutiesTotal" ccy={base} disabled={applied || busy} onSaved={setD} />
            <Charge key={`other-${shipment.otherTotal}`} label="Other" value={shipment.otherTotal} id={id} field="otherTotal" ccy={base} disabled={applied || busy} onSaved={setD} />
            <div>
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">To spread</span>
              <span className="text-base font-semibold text-ink">{money(charges, base)}</span>
            </div>
          </div>
          {/* Evidence, not a value. Worth seeing beside the forwarder's figure because sometimes it is
              the same shipment quoted twice — and worth NOT copying automatically, because it is in the
              invoice's currency and this box is in base currency. */}
          {invoice.extractedFreight ? (
            <p className="mt-3 text-xs text-subtle">
              {`The supplier's own invoice also lists ${money(invoice.extractedFreight, inv)} of freight`}
              {invoice.extractedDuties ? ` and ${money(invoice.extractedDuties, inv)} of duty` : ''}
              {`. Not copied above — these boxes are ${base}, from your forwarder. Check whether it is the same shipment billed twice.`}
            </p>
          ) : (
            <p className="mt-3 text-xs text-subtle">{`Type these from your forwarder's bill, in ${base}.`}</p>
          )}
        </div>
      </section>

      {rateMissing && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {`This invoice is in ${inv} and your costs are kept in ${base}. Enter the rate you paid above before applying — `}
          {`without it these products would take the freight but end up with no landed cost at all.`}
        </p>
      )}

      {wrongFreightCurrency && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {`The freight on this shipment is recorded in ${shipment.currency} but costs are kept in ${base}. `}
          {`Freight is never converted — it comes from the forwarder in ${base}. Re-enter it above.`}
        </p>
      )}

      {/* ── The cost moved enough to move the margin. ───────────────────────────────────────────────
          
          Distinct from the reorder notice above it, and the distinction is the point. That one fires
          on OVERLAP — this product has a cost from an earlier shipment — which is true of every repeat
          order and becomes wallpaper by the third one. This fires on DIVERGENCE: the number is about
          to move materially, and if the product has a price, its margin moves with it.
          
          The subject is the margin, not the cost. A cost rising is not the harm; a price that didn't
          move with it is. See lib/invoices/divergence.ts.
          
          Never says which of the two figures is wrong — it cannot know, and a message that picked one
          would send the owner to correct the correct number. */}
      {divergences.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {divergenceHeadline(divergences)}
          </p>
          <ul className="mt-2 space-y-1.5">
            {divergences.map((x) => (
              <li key={x.productId} className="text-sm text-amber-900">
                {divergenceSentence(x, base)}
                {/* The shapes are questions, not verdicts. Each one names a way the two figures could
                    disagree and leaves the invoice to settle it. */}
                {x.shapes.map((sh) => (
                  <span key={sh.kind} className="mt-0.5 block text-xs text-amber-800">{sh.note}</span>
                ))}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            {collapsing.length > 0
              ? 'Applying is fine if the new figures are right — but the selling prices above have not moved, so check them too.'
              : 'Applying is fine if the new figures are right. Compare them against the invoice first.'}
          </p>
        </div>
      )}

      {reorders.length > 0 && !applied && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {`${reorders.length} product${reorders.length === 1 ? '' : 's'} on this invoice already carr${reorders.length === 1 ? 'ies' : 'y'} freight from an earlier shipment.`}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            A product holds one shipment&rsquo;s freight at a time, so applying this one replaces what the
            earlier one put there rather than adding to it. If that is what you want — the same goods
            reordered, at this shipment&rsquo;s freight — carry on. The affected lines are marked below.
          </p>
        </div>
      )}

      {/* Several lines landing on ONE product. They do not overwrite each other — the apply groups by
          product, so their costs merge into a quantity-weighted average and their freight sums. Right
          for one product listed twice; wrong when the matcher put different products on one row, and
          worse than an overwrite because the average appears on no piece of paper. */}
      {shared.length > 0 && !applied && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {`${shared.length} lines are matched to the same product as another line.`}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Their costs will be <strong>averaged into one figure</strong>, not kept separately — so the
            stored cost will be a number that appears on no line of the invoice. That is right when one
            product genuinely appears twice. If these are different products, match them separately or
            create them below.
          </p>
        </div>
      )}

      {/* THE coverage line. Not a footnote: it is what makes spreading freight over matched lines only
          an honest choice rather than a silent one. */}
      <section className={`mb-4 rounded-xl border px-4 py-3 ${below ? 'border-amber-200 bg-amber-50' : 'border-hairline-strong bg-white'}`}>
        <p className={`text-sm ${below ? 'text-amber-900' : 'text-ink'}`}>
          <strong>{money(charges, base)}</strong>
          {` spread across ${cov.matchedLines} of ${lines.length} lines — `}
          <strong>{`${(cov.ratio * 100).toFixed(0)}%`}</strong>
          {` of the invoice's value.`}
        </p>
        {cov.unmatchedLines > 0 && (
          <p className={`mt-1 text-sm ${below ? 'text-amber-800' : 'text-muted'}`}>
            {`${cov.unmatchedLines} line${cov.unmatchedLines === 1 ? '' : 's'} unmatched (${money(cov.unmatchedValue, inv)})`}
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
          <Line key={l.id} line={l} invoiceCcy={inv} baseCcy={base} markup={settings.markupPercent}
            rate={foreign ? invoice.exchangeRate : 1} disabled={applied || busy} onPatch={patchLine}
            picked={picked.has(l.id)}
            name={names[l.id]}
            onPick={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(l.id); else n.delete(l.id); return n })}
            onRename={(v) => setNames((n) => ({ ...n, [l.id]: v }))} />
        ))}
      </ul>

      {/* Creating products from unmatched lines. For a business setting up from scratch this is the
          whole point — the invoices ARE the catalogue. Deliberately NOT a one-click "create all": the
          owner ticks what they want, because a catalogue full of rows nobody chose still has to be
          cleaned by hand, and this is the one moment the description and the price are both in front
          of them. Same rule the catalog ingestion module holds itself to. */}
      {!applied && creatable.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline-strong bg-white px-4 py-3">
          <div>
            <p className="text-sm text-ink">
              {picked.size === 0
                ? `${creatable.length} line${creatable.length === 1 ? '' : 's'} matched nothing in your catalogue.`
                : `${picked.size} selected.`}
            </p>
            <p className="mt-0.5 text-xs text-subtle">
              {`New products are created with their cost and no selling price, so they are never quoted `}
              {`until you price them. Their name can be edited on each line first.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" disabled={busy}
              onClick={() => setPicked(picked.size === creatable.length ? new Set() : new Set(creatable.map((l) => l.id)))}
              className="text-sm font-medium text-accent underline">
              {picked.size === creatable.length ? 'Clear' : `Select all ${creatable.length}`}
            </button>
            <button type="button" onClick={createProducts} disabled={busy || picked.size === 0}
              className="h-10 rounded-lg border border-hairline-strong px-4 text-sm font-semibold text-ink hover:bg-sunken/50 disabled:opacity-40">
              {busy ? 'Creating…' : `Create ${picked.size || ''} product${picked.size === 1 ? '' : 's'}`.replace('  ', ' ')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {applied ? (
          <>
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" /> Applied {shipment.appliedAt && new Date(shipment.appliedAt).toLocaleString()}
            </p>
            {confirmReapply ? (
              <span className="flex items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {`This overwrites the shipping and duty on all ${cov.matchedLines} matched products with the figures above.`}
                <button type="button" onClick={() => apply({ override: below, reapply: true, acknowledgeDivergence: true })} disabled={busy}
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
            {/* One extra press when a margin is about to move, and the press is the record: the
                server refuses without the acknowledgement and stores what was on screen when it came.
                Six months on, "why is this sofa's margin 19%" is answerable from the shipment row. */}
            {confirmDivergence && divergences.length > 0 ? (
              <span className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {collapsing.length > 0
                  ? `This applies the new costs and leaves ${collapsing.length === 1 ? 'that product' : 'those products'} priced as ${collapsing.length === 1 ? 'it is' : 'they are'}.`
                  : 'This applies the new costs shown above.'}
                <button type="button" onClick={() => apply({ override: below, acknowledgeDivergence: true })} disabled={busy}
                  className="font-semibold underline">{busy ? 'Applying…' : 'Apply anyway'}</button>
                <button type="button" onClick={() => setConfirmDivergence(false)} className="underline">Cancel</button>
              </span>
            ) : (
              <button type="button"
                onClick={() => (divergences.length ? setConfirmDivergence(true) : apply())}
                disabled={busy || blocked}
                className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Applying…' : `Apply to ${cov.matchedLines} product${cov.matchedLines === 1 ? '' : 's'}`}
              </button>
            )}
            {/* Coverage is the only thing here with an override — it is a judgement the owner is
                entitled to make. A missing rate and a mis-denominated freight figure are not
                judgements, they are wrong numbers, and there is no button for those. */}
            {below && !rateMissing && !wrongFreightCurrency && cov.matchedLines > 0 && (
              <button type="button"
                onClick={() => (divergences.length ? setConfirmDivergence(true) : apply({ override: true }))}
                disabled={busy}
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
 * The rate paid on this invoice. Seeded once from the server; a change from the server remounts it via
 * `key` rather than being re-synced with an effect, which would be state derived from a prop and would
 * fight the cursor mid-edit.
 */
function Rate({ id, from, to, value, disabled, onSaved }: {
  id: string; from: string; to: string; value: number | null; disabled: boolean
  onSaved: (d: ShipmentDetail) => void
}) {
  const [v, setV] = useState(value ? String(value) : '')

  const save = async () => {
    const t = v.trim()
    const n = t ? Number(t) : null
    if (t && (!Number.isFinite(n) || (n as number) <= 0)) return
    if (n === value) return
    const r = await fetch(`/api/invoices/shipments/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRate: n }),
    })
    if (r.ok) onSaved(await r.json())
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Exchange rate</span>
      <span className="flex items-center gap-2">
        <span className="text-sm text-muted">{`1 ${from} =`}</span>
        <input className="h-10 w-32 rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent disabled:bg-sunken/60"
          inputMode="decimal" value={v} placeholder="0.00" disabled={disabled}
          onChange={(e) => setV(e.target.value)} onBlur={save} />
        <span className="text-sm text-muted">{to}</span>
      </span>
    </label>
  )
}

/** One editable charge from the forwarder's bill. Always in base currency. */
function Charge({ label, value, id, field, ccy, disabled, onSaved }: {
  label: string; value: number; id: string; field: string; ccy: string; disabled: boolean
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
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{`${label} (${ccy})`}</span>
      <input className="h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent disabled:bg-sunken/60"
        inputMode="decimal" value={v} placeholder="0" disabled={disabled}
        onChange={(e) => setV(e.target.value)} onBlur={save} />
    </label>
  )
}

function Line({ line, invoiceCcy, baseCcy, markup, rate, disabled, onPatch, picked, name, onPick, onRename }: {
  line: InvoiceLine; invoiceCcy: string; baseCcy: string; markup: number; rate: number | null
  disabled: boolean
  onPatch: (id: string, body: { productId?: string | null; skip?: boolean }) => void
  picked: boolean
  name: string | undefined
  onPick: (on: boolean) => void
  onRename: (v: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; sku: string | null }>>([])

  const openPicker = async () => {
    setPicking(true)
    const r = await fetch(`/api/invoices/lines/${line.id}`)
    if (r.ok) setSuggestions((await r.json()).suggestions ?? [])
  }

  // The unit cost twice: as the supplier wrote it, and as it will be stored. Showing both is the check
  // the owner actually performs — read the paper, read the screen, see the same number — and it is the
  // only place a mistyped rate becomes visible before it reaches a product.
  const unit = line.quantity && line.quantity > 0 ? line.extended / line.quantity : null
  const unitBase = unit !== null && rate !== null ? unit * rate : null

  // What this line will do to the product's landed cost.
  //
  // PER UNIT, like everything in product_costs: the allocation is a whole line's share of the freight
  // pool, but cost_primary is what one unit cost and margin is measured against one unit's selling
  // price. apply_shipment_costs divides by the same quantity in SQL — unitShare is the shared
  // definition so the preview and the write cannot disagree.
  const preview = landedCost(
    unitBase,
    unitShare(line.allocatedFreight, line.quantity),
    unitShare(line.allocatedDuties, line.quantity),
    markup,
  )

  const sameCurrency = invoiceCcy.toUpperCase() === baseCcy.toUpperCase()

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Only unmatched lines can become products, so only they get a checkbox. */}
        {!disabled && line.status === 'unmatched' && (
          <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)}
            aria-label={`Create a product from line ${line.lineNo}`}
            className="mt-1 h-4 w-4 shrink-0 rounded border-hairline-strong accent-accent" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{line.description || `Line ${line.lineNo}`}</p>
          <p className="mt-0.5 text-xs text-muted">
            {[
              line.sku && `SKU ${line.sku}`,
              line.quantity !== null && `${line.quantity} ×`,
              line.unitPrice !== null && money(line.unitPrice, invoiceCcy),
              `= ${money(line.extended, invoiceCcy)}`,
            ].filter(Boolean).join(' · ')}
          </p>

          {line.status === 'matched' && (
            <p className="mt-1 text-xs">
              <span className="text-emerald-700">→ {line.productName || 'product'}</span>
              {line.productSku && <span className="text-muted"> ({line.productSku})</span>}
              <span className="text-subtle">
                {` · ${METHOD[line.matchMethod ?? ''] ?? 'Matched'}`}
                {(line.sharesProductWith ?? 0) > 0 && ` · shared with ${line.sharesProductWith} other line${line.sharesProductWith === 1 ? '' : 's'}, costs averaged`}
                {line.matchMethod === 'name_trigram' && line.matchConfidence !== null && ` (${Math.round(line.matchConfidence * 100)}%)`}
              </span>
            </p>
          )}
          {line.status === 'unmatched' && !picked && <p className="mt-1 text-xs text-amber-700">Not matched to a product</p>}

          {/* The name decides whether the catalogue is usable, and this is the one moment the supplier's
              description and its price are both on screen. Defaults to the raw description, unedited —
              their shorthand is better evidence than our title-casing. */}
          {picked && (
            <label className="mt-2 block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Product name</span>
              <input className="h-9 w-full max-w-md rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent"
                value={name ?? line.description ?? ''} onChange={(e) => onRename(e.target.value)} />
              {line.sku && <span className="mt-1 block text-xs text-subtle">{`SKU ${line.sku} — kept as the supplier wrote it, so their next invoice matches this product instead of creating another.`}</span>}
            </label>
          )}
          {line.status === 'skipped' && <p className="mt-1 text-xs text-subtle">Skipped — takes no share of the freight</p>}

          {line.priorShipment && (
            <p className="mt-1 text-xs text-amber-700">
              {`Already carries ${money(line.priorShipment.amount, baseCcy)} from ${line.priorShipment.reference || 'an earlier shipment'}`}
              {line.priorShipment.appliedAt && ` (${new Date(line.priorShipment.appliedAt).toLocaleDateString()})`}
              {' — applying replaces it.'}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {line.status === 'matched' && (
            <>
              {/* Unit cost converted, shown only when there is a conversion to check. */}
              {!sameCurrency && (
                <p className="text-xs text-subtle">
                  {unitBase === null
                    ? `Unit cost — needs the rate`
                    : `Unit ${money(unit, invoiceCcy)} → ${money(unitBase, baseCcy)}`}
                </p>
              )}
              <p className="text-xs text-subtle">Takes</p>
              <p className="text-sm font-medium text-ink">{money(line.allocatedFreight + line.allocatedDuties, baseCcy)}</p>
              {preview !== null && <p className="text-xs text-muted">Lands at {money(preview, baseCcy)}</p>}
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
