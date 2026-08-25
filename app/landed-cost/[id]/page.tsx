'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Check, ExternalLink, Search, X, Ship, Plus } from 'lucide-react'
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
    <div className="v2 v2-embedded mx-auto max-w-5xl p-4 sm:p-6" style={{ paddingBottom: 'calc(24px + var(--v2-grab-h))' }}>
      {/* The shipment's own name is the page — the rail says "Supplier bills", not which one. */}
      <div className="v2-head">
        <Link href="/landed-cost" className="v2-act tap-target"><ArrowLeft className="w-3.5 h-3.5" /> Shipments</Link>
        <s />
        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noreferrer" className="v2-act tap-target">
            <ExternalLink className="w-3.5 h-3.5" /> View invoice
          </a>
        )}
      </div>

      <header style={{ marginBottom: 26 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--v2-ink)' }}>{shipment.reference || invoice.fileName}</h1>
          <p className="v2-kick" style={{ marginTop: 8 }}>
            {[
              invoice.supplierName,
              invoice.invoiceNumber && `Invoice ${invoice.invoiceNumber}`,
              invoice.invoiceDate && new Date(invoice.invoiceDate).toLocaleDateString(),
              `Invoiced in ${inv}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>

      {invoice.status === 'failed' && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)', marginBottom: 16 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>{invoice.extractionError || 'This invoice could not be read.'}</p>
        </div>
      )}
      {err && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)', marginBottom: 16 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span><p>{err}</p>
        </div>
      )}
      {invoice.matchNote && <p className="v2-hint" style={{ marginBottom: 16 }}>{invoice.matchNote}</p>}

      {/* THE TWO DOCUMENTS, kept visibly apart because they are two documents.
          Left: the supplier's invoice and the rate paid on it. Right: the forwarder's bill. */}
      <section style={{ display: 'grid', gap: 30, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 26 }}>
        <div>
          <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />{`Supplier invoice · ${inv}`}</p><s /></div>
          {foreign ? (
            <>
              <Rate key={`rate-${invoice.exchangeRate ?? ''}`} id={id} from={inv} to={base}
                value={invoice.exchangeRate} disabled={applied || busy} onSaved={setD} />
              <p className="v2-hint" style={{ marginTop: 10 }}>
                {`The rate you actually paid on this invoice. It converts the line values below into ${base} — `}
                {`and nothing else. Freight is never multiplied by it: that arrives from your forwarder already in ${base}.`}
              </p>
            </>
          ) : (
            <p className="v2-hint">{`Invoiced in ${base}, so nothing needs converting.`}</p>
          )}
          {invoice.grandTotal !== null && (
            <dl className="v2-tot" style={{ justifyContent: 'flex-start', padding: '14px 0 0' }}>
              <div><dt>Invoice total</dt><dd>{money(invoice.grandTotal, inv)}</dd></div>
            </dl>
          )}
        </div>

        <div>
          <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />{`Freight forwarder · ${base}`}</p><s /></div>
          <div className="v2-form" data-cols="3" style={{ gap: '18px 22px' }}>
            <Charge key={`freight-${shipment.freightTotal}`} label="Freight" value={shipment.freightTotal} id={id} field="freightTotal" ccy={base} disabled={applied || busy} onSaved={setD} />
            <Charge key={`duties-${shipment.dutiesTotal}`} label="Duty" value={shipment.dutiesTotal} id={id} field="dutiesTotal" ccy={base} disabled={applied || busy} onSaved={setD} />
            <Charge key={`other-${shipment.otherTotal}`} label="Other" value={shipment.otherTotal} id={id} field="otherTotal" ccy={base} disabled={applied || busy} onSaved={setD} />
            <div className="v2-fld">
              <span className="v2-flab" style={{ marginBottom: 0 }}>To spread</span>
              <span style={{ paddingTop: 8, fontSize: 16, fontWeight: 600, color: 'var(--v2-ink)', fontVariantNumeric: 'tabular-nums' }}>{money(charges, base)}</span>
            </div>
          </div>
          {/* Evidence, not a value. Worth seeing beside the forwarder's figure because sometimes it is
              the same shipment quoted twice — and worth NOT copying automatically, because it is in the
              invoice's currency and this box is in base currency. */}
          {invoice.extractedFreight ? (
            <p className="v2-hint" style={{ marginTop: 14 }}>
              {`The supplier's own invoice also lists ${money(invoice.extractedFreight, inv)} of freight`}
              {invoice.extractedDuties ? ` and ${money(invoice.extractedDuties, inv)} of duty` : ''}
              {`. Not copied above — these boxes are ${base}, from your forwarder. Check whether it is the same shipment billed twice.`}
            </p>
          ) : (
            <p className="v2-hint" style={{ marginTop: 14 }}>{`Type these from your forwarder's bill, in ${base}.`}</p>
          )}
        </div>
      </section>

      {rateMissing && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', marginBottom: 16 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            {`This invoice is in ${inv} and your costs are kept in ${base}. Enter the rate you paid above before applying — `}
            {`without it these products would take the freight but end up with no landed cost at all.`}
          </p>
        </div>
      )}

      {wrongFreightCurrency && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', marginBottom: 16 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            {`The freight on this shipment is recorded in ${shipment.currency} but costs are kept in ${base}. `}
            {`Freight is never converted — it comes from the forwarder in ${base}. Re-enter it above.`}
          </p>
        </div>
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
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start', marginBottom: 16 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            {divergenceHeadline(divergences)}
            <span style={{ display: 'block', marginTop: 8 }}>
              {divergences.map((x) => (
                <span key={x.productId} style={{ display: 'block', marginTop: 6, fontSize: 13.5, fontWeight: 400, color: 'var(--v2-ink-72)' }}>
                  {divergenceSentence(x, base)}
                  {/* The shapes are questions, not verdicts. Each one names a way the two figures could
                      disagree and leaves the invoice to settle it. */}
                  {x.shapes.map((sh) => (
                    <span key={sh.kind} style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>{sh.note}</span>
                  ))}
                </span>
              ))}
            </span>
            <span style={{ display: 'block', marginTop: 10, fontSize: 12.5, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
              {collapsing.length > 0
                ? 'Applying is fine if the new figures are right — but the selling prices above have not moved, so check them too.'
                : 'Applying is fine if the new figures are right. Compare them against the invoice first.'}
            </span>
          </p>
        </div>
      )}

      {reorders.length > 0 && !applied && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start', marginBottom: 16 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            {`${reorders.length} product${reorders.length === 1 ? '' : 's'} on this invoice already carr${reorders.length === 1 ? 'ies' : 'y'} freight from an earlier shipment.`}
            <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
              A product holds one shipment&rsquo;s freight at a time, so applying this one replaces what the
              earlier one put there rather than adding to it. If that is what you want — the same goods
              reordered, at this shipment&rsquo;s freight — carry on. The affected lines are marked below.
            </span>
          </p>
        </div>
      )}

      {/* Several lines landing on ONE product. They do not overwrite each other — the apply groups by
          product, so their costs merge into a quantity-weighted average and their freight sums. Right
          for one product listed twice; wrong when the matcher put different products on one row, and
          worse than an overwrite because the average appears on no piece of paper. */}
      {shared.length > 0 && !applied && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start', marginBottom: 16 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            {`${shared.length} lines are matched to the same product as another line.`}
            <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
              Their costs will be <b style={{ fontWeight: 600, color: 'var(--v2-ink)' }}>averaged into one figure</b>, not kept separately — so the
              stored cost will be a number that appears on no line of the invoice. That is right when one
              product genuinely appears twice. If these are different products, match them separately or
              create them below.
            </span>
          </p>
        </div>
      )}

      {/* THE coverage line. Not a footnote: it is what makes spreading freight over matched lines only
          an honest choice rather than a silent one. */}
      {/* THE coverage line. Not a footnote: it is what makes spreading freight over matched lines
          only an honest choice rather than a silent one. It is a notice only when coverage is below
          the bar — otherwise it is a statement of fact and does not need a coloured surface. */}
      <div className="v2-notice" style={{ ['--ghue' as string]: below ? 'var(--v2-amber)' : 'var(--v2-t3)', alignItems: 'flex-start', marginBottom: 22 }}>
        <span className="v2-chip-sq"><Ship /></span>
        <p>
          <b style={{ fontWeight: 600 }}>{money(charges, base)}</b>
          {` spread across ${cov.matchedLines} of ${lines.length} lines — `}
          <b style={{ fontWeight: 600 }}>{`${(cov.ratio * 100).toFixed(0)}%`}</b>
          {` of the invoice's value.`}
        {cov.unmatchedLines > 0 && (
          <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
            {`${cov.unmatchedLines} line${cov.unmatchedLines === 1 ? '' : 's'} unmatched (${money(cov.unmatchedValue, inv)})`}
            {cov.skippedLines > 0 && `, ${cov.skippedLines} skipped on purpose`}
            {below
              ? '. Their share of the freight lands on the matched products instead, so those costs will be overstated. Match them below before applying.'
              : '. Their share of the freight lands on the matched products instead.'}
          </span>
        )}
        <span style={{ display: 'block', marginTop: 8, fontSize: 12.5, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
          Freight is divided by line value — a proxy for weight, which the invoice does not carry.
        </span>
        </p>
      </div>

      <div className="v2-list">
        {lines.map((l) => (
          <Line key={l.id} line={l} invoiceCcy={inv} baseCcy={base} markup={settings.markupPercent}
            rate={foreign ? invoice.exchangeRate : 1} disabled={applied || busy} onPatch={patchLine}
            commission={shipment.commissionPercent ?? settings.commissionPercent}
            picked={picked.has(l.id)}
            name={names[l.id]}
            onPick={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(l.id); else n.delete(l.id); return n })}
            onRename={(v) => setNames((n) => ({ ...n, [l.id]: v }))} />
        ))}
      </div>

      {/* Creating products from unmatched lines. For a business setting up from scratch this is the
          whole point — the invoices ARE the catalogue. Deliberately NOT a one-click "create all": the
          owner ticks what they want, because a catalogue full of rows nobody chose still has to be
          cleaned by hand, and this is the one moment the description and the price are both in front
          of them. Same rule the catalog ingestion module holds itself to. */}
      {!applied && creatable.length > 0 && (
        <div className="v2-grow" data-static style={{ ['--ghue' as string]: 'var(--v2-t1)', marginTop: 22, flexWrap: 'wrap' }}>
          <span className="v2-gchip"><Plus /></span>
          <span className="v2-glab">
            <b style={{ fontWeight: 550 }}>
              {picked.size === 0
                ? `${creatable.length} line${creatable.length === 1 ? '' : 's'} matched nothing in your catalogue.`
                : `${picked.size} selected.`}
            </b>
            <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
              {`New products are created with their cost and no selling price, so they are never quoted `}
              {`until you price them. Their name can be edited on each line first.`}
            </span>
          </span>
          <span className="v2-gtrail">
            <button type="button" disabled={busy}
              onClick={() => setPicked(picked.size === creatable.length ? new Set() : new Set(creatable.map((l) => l.id)))}
              className="v2-act tap-target">
              {picked.size === creatable.length ? 'Clear' : `Select all ${creatable.length}`}
            </button>
            <button type="button" onClick={createProducts} disabled={busy || picked.size === 0}
              className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
              {busy ? 'Creating…' : `Create ${picked.size || ''} product${picked.size === 1 ? '' : 's'}`.replace('  ', ' ')}
            </button>
          </span>
        </div>
      )}

      <div className="v2-bar" style={{ marginTop: 26 }}>
        {applied ? (
          <>
            <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t3)' }}>
              <Check className="w-3 h-3" /> Applied {shipment.appliedAt && new Date(shipment.appliedAt).toLocaleString()}
            </span>
            {confirmReapply ? (
              /* The sentences and the button that acknowledges them live in ONE block, deliberately.
                 
                 They were separated before: the banner rendered elsewhere on the page and this button
                 sent acknowledgeDivergence unconditionally, on the reasoning that "the banner is
                 visible above." That let the client assert something about its own rendering that the
                 server could not check — and on 7 Aug 2026 a stale tab produced exactly that: 166
                 products' costs moved with a record claiming their sentences had been read, when the
                 banner was never on screen. Rendering them together makes the claim structurally
                 true rather than merely usually true. */
              <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start', flex: '1 1 100%' }}>
                <span className="v2-chip-sq"><AlertTriangle /></span>
                <p>
                  {`This overwrites the shipping and duty on all ${cov.matchedLines} matched products with the figures above.`}
                {divergences.length > 0 && (
                  <>
                    <span style={{ display: 'block', marginTop: 8, fontWeight: 600 }}>{divergenceHeadline(divergences)}:</span>
                    <span style={{ display: 'block', maxHeight: 224, overflowY: 'auto', marginTop: 4 }}>
                      {divergences.map((x) => <span key={x.productId} style={{ display: 'block', marginTop: 3, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-72)' }}>{divergenceSentence(x, base)}</span>)}
                    </span>
                  </>
                )}
                <span className="v2-bar" style={{ marginTop: 12 }}>
                  {/* Only ever true from inside this block. If the tab is stale and the server finds
                      a divergence this list does not contain, the apply is refused and comes back
                      with the real one rather than being recorded as acknowledged. */}
                  <button type="button"
                    onClick={() => apply({ override: below, reapply: true, acknowledgeDivergence: divergences.length > 0 })}
                    disabled={busy} className="v2-act tap-target" data-solid data-danger>
                    {busy ? 'Applying…' : 'Overwrite'}
                  </button>
                  <button type="button" onClick={() => setConfirmReapply(false)} className="v2-act tap-target">Cancel</button>
                </span>
                </p>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmReapply(true)} className="v2-act tap-target">
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
              <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start', flex: '1 1 100%' }}>
                <span className="v2-chip-sq"><AlertTriangle /></span>
                <p>
                  {collapsing.length > 0
                    ? `This applies the new costs and leaves ${collapsing.length === 1 ? 'that product' : 'those products'} priced as ${collapsing.length === 1 ? 'it is' : 'they are'}.`
                    : 'This applies the new costs shown above.'}
                  <span className="v2-bar" style={{ marginTop: 12 }}>
                    <button type="button" onClick={() => apply({ override: below, acknowledgeDivergence: true })} disabled={busy}
                      className="v2-act tap-target" data-solid>{busy ? 'Applying…' : 'Apply anyway'}</button>
                    <button type="button" onClick={() => setConfirmDivergence(false)} className="v2-act tap-target">Cancel</button>
                  </span>
                </p>
              </div>
            ) : (
              <button type="button"
                onClick={() => (divergences.length ? setConfirmDivergence(true) : apply())}
                disabled={busy || blocked}
                className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
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
                className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-amber)' }}>
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
    <div className="v2-fld">
      <label htmlFor="lc-rate">Exchange rate</label>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="v2-kick" style={{ marginBottom: 0 }}>{`1 ${from} =`}</span>
        <input id="lc-rate" style={{ width: 120 }}
          inputMode="decimal" value={v} placeholder="0.00" disabled={disabled}
          onChange={(e) => setV(e.target.value)} onBlur={save} />
        <span className="v2-kick" style={{ marginBottom: 0 }}>{to}</span>
      </span>
    </div>
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
    <div className="v2-fld">
      <label htmlFor={`lc-${field}`}>{`${label} (${ccy})`}</label>
      <input id={`lc-${field}`}
        inputMode="decimal" value={v} placeholder="0" disabled={disabled}
        onChange={(e) => setV(e.target.value)} onBlur={save} />
    </div>
  )
}

function Line({ line, invoiceCcy, baseCcy, markup, commission, rate, disabled, onPatch, picked, name, onPick, onRename }: {
  line: InvoiceLine; invoiceCcy: string; baseCcy: string; markup: number; commission: number; rate: number | null
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
  const preview = landedCost({
    costPrimary: unitBase,
    shippingCost: unitShare(line.allocatedFreight, line.quantity),
    tariffCost: unitShare(line.allocatedDuties, line.quantity),
    markupPercent: markup,
    commissionPercent: commission,
  })

  const sameCurrency = invoiceCcy.toUpperCase() === baseCcy.toUpperCase()

  return (
    /* A LINE IS A ROW, and its hue is its state: mute when matched and settled, amber when nothing
       in the catalogue claims it, and nothing at all once the shipment is applied. */
    <li className="v2-row" style={{ ['--chan' as string]: line.status === 'unmatched' ? 'var(--v2-amber)' : line.status === 'skipped' ? 'var(--v2-mute)' : 'var(--v2-t3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: '1 1 260px', minWidth: 0 }}>
        {/* Only unmatched lines can become products, so only they get a checkbox. */}
        {!disabled && line.status === 'unmatched' && (
          <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)}
            aria-label={`Create a product from line ${line.lineNo}`}
            style={{ flex: 'none', marginTop: 3, width: 17, height: 17, borderRadius: 5, accentColor: 'var(--v2-t1)' }} />
        )}
        <div className="min-w-0" style={{ flex: 1 }}>
          <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--v2-ink)' }}>{line.description || `Line ${line.lineNo}`}</p>
          <p className="v2-hint" style={{ marginTop: 2 }}>
            {[
              line.sku && `SKU ${line.sku}`,
              line.quantity !== null && `${line.quantity} ×`,
              line.unitPrice !== null && money(line.unitPrice, invoiceCcy),
              `= ${money(line.extended, invoiceCcy)}`,
            ].filter(Boolean).join(' · ')}
          </p>

          {line.status === 'matched' && (
            <p style={{ marginTop: 5, fontSize: 12.5 }}>
              <span style={{ color: 'var(--v2-ink)', fontWeight: 500 }}>→ {line.productName || 'product'}</span>
              {line.productSku && <span style={{ color: 'var(--v2-mute)' }}> ({line.productSku})</span>}
              <span style={{ color: 'var(--v2-ink-45)' }}>
                {` · ${METHOD[line.matchMethod ?? ''] ?? 'Matched'}`}
                {(line.sharesProductWith ?? 0) > 0 && ` · shared with ${line.sharesProductWith} other line${line.sharesProductWith === 1 ? '' : 's'}, costs averaged`}
                {line.matchMethod === 'name_trigram' && line.matchConfidence !== null && ` (${Math.round(line.matchConfidence * 100)}%)`}
              </span>
            </p>
          )}
          {line.status === 'unmatched' && !picked && <p className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-amber)', marginTop: 6 }}>Not matched to a product</p>}

          {/* The name decides whether the catalogue is usable, and this is the one moment the supplier's
              description and its price are both on screen. Defaults to the raw description, unedited —
              their shorthand is better evidence than our title-casing. */}
          {picked && (
            <div className="v2-fld" style={{ marginTop: 12, maxWidth: 420 }}>
              <label htmlFor={`lc-name-${line.id}`}>Product name</label>
              <input id={`lc-name-${line.id}`}
                value={name ?? line.description ?? ''} onChange={(e) => onRename(e.target.value)} />
              {line.sku && <span className="v2-hint">{`SKU ${line.sku} — kept as the supplier wrote it, so their next invoice matches this product instead of creating another.`}</span>}
            </div>
          )}
          {line.status === 'skipped' && <p className="v2-hint" style={{ marginTop: 5 }}>Skipped — takes no share of the freight</p>}

          {line.priorShipment && (
            <p className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-amber)', marginTop: 6 }}>
              {`Already carries ${money(line.priorShipment.amount, baseCcy)} from ${line.priorShipment.reference || 'an earlier shipment'}`}
              {line.priorShipment.appliedAt && ` (${new Date(line.priorShipment.appliedAt).toLocaleDateString()})`}
              {' — applying replaces it.'}
            </p>
          )}
        </div>
      </div>

      <div style={{ flex: 'none', textAlign: 'right', marginLeft: 'auto' }}>
        {line.status === 'matched' && (
          <>
            {/* Unit cost converted, shown only when there is a conversion to check. */}
            {!sameCurrency && (
              <p className="v2-hint">
                {unitBase === null
                  ? `Unit cost — needs the rate`
                  : `Unit ${money(unit, invoiceCcy)} → ${money(unitBase, baseCcy)}`}
              </p>
            )}
            {/* The two figures this row exists to report, as the totals row — mono label over a
                tabular figure, so a column of them lines up down the list. */}
            <dl className="v2-tot" style={{ padding: 0, gap: '2px 18px' }}>
              <div><dt>Takes</dt><dd>{money(line.allocatedFreight + line.allocatedDuties, baseCcy)}</dd></div>
              {preview !== null && <div><dt>Lands at</dt><dd>{money(preview, baseCcy)}</dd></div>}
            </dl>
          </>
        )}
        {!disabled && (
          <div className="v2-bar" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={openPicker} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
              {line.status === 'matched' ? 'Change' : 'Match'}
            </button>
            {line.status !== 'skipped' && (
              <button type="button" onClick={() => onPatch(line.id, { skip: true })} className="v2-act tap-target">Skip</button>
            )}
            {line.status === 'skipped' && (
              <button type="button" onClick={() => onPatch(line.id, { skip: false, productId: null })} className="v2-act tap-target">Un-skip</button>
            )}
          </div>
        )}
      </div>

      {/* The match picker, in the kit's popover — same paper, same hairline, no shadow. Rendered in
          flow rather than absolutely, because it belongs to a row in a long list and a floating panel
          over the next four rows hides the very lines you are comparing it against. */}
      {picking && (
        <div style={{ flex: '1 1 100%', marginTop: 12 }}>
          <div className="v2-pop" style={{ position: 'static', maxHeight: 'none' }}>
            <div className="v2-head" style={{ margin: '10px 13px 0' }}>
              <p className="v2-kick" style={{ marginBottom: 0 }}><Search className="w-3 h-3" /> Closest products</p>
              <s />
              <button type="button" onClick={() => setPicking(false)} className="v2-ico" aria-label="Close"><X /></button>
            </div>
            {suggestions.length === 0 ? (
              <p className="v2-hint" style={{ padding: '4px 13px 12px' }}>Nothing in the catalogue looks close. Add the product first, then match this line.</p>
            ) : (
              <ul style={{ paddingBottom: 4 }}>
                {suggestions.map((s2) => (
                  <li key={s2.id}>
                    <button type="button"
                      onClick={() => { onPatch(line.id, { productId: s2.id }); setPicking(false) }}
                      className="v2-popr">
                      <span className="v2-popn">{s2.name}{s2.sku && <span style={{ color: 'var(--v2-mute)' }}> ({s2.sku})</span>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
