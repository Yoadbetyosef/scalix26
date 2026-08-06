'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Lock } from 'lucide-react'

// Cost & Margin for one product.
//
// The card decides whether to exist by asking the endpoint. A 403 means this session may not see costs,
// and the card renders nothing — no prop threaded down from the page, no second copy of the rule to
// drift. The endpoint is the authority; this is only its reflection, which is the right order for UI
// hiding to be the last layer rather than the only one.
//
// Nothing about currency or markup is written here. Both arrive from tenant settings, and a business
// with no secondary currency never sees that column at all.

interface Settings { markupPercent: number; baseCurrency: string; secondaryCurrency: string | null; combineShippingAndDuties: boolean }
interface Cost {
  costPrimary: number | null; costSecondary: number | null
  shippingCost: number; tariffCost: number; markupPercent: number
  computedCost: number | null; updatedAt: string | null
}
interface View { settings: Settings; price: number | null; cost: Cost | null; marginPercent: number | null }

const input = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const num = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null }
const fmt = (n: number | null, ccy: string) =>
  n === null ? '—' : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ccy}`

// Turning the one figure the owner typed back into the two columns the database keeps.
//
// The tariff already recorded is left EXACTLY as it is and the remainder goes to shipping, so the
// total is what they typed while the customs figure survives — which is the whole reason the columns
// weren't merged. A brand-new row has no tariff, so the combined figure simply becomes shipping.
//
// If the combined figure is smaller than the recorded tariff, honouring the number they typed has to
// win: shipping goes to zero and tariff is reduced to match. That is the one case where the split is
// lost, and it only happens when the owner says the total is less than the duty alone.
export function splitLanded(
  combined: boolean,
  f: { shipping: string; tariff: string; landed: string },
  recordedTariff: number,
): { shippingCost: number; tariffCost: number } {
  if (!combined) return { shippingCost: num(f.shipping) ?? 0, tariffCost: num(f.tariff) ?? 0 }
  const total = num(f.landed) ?? 0
  if (total < recordedTariff) return { shippingCost: 0, tariffCost: total }
  return { shippingCost: total - recordedTariff, tariffCost: recordedTariff }
}

// Thin margins are the thing worth noticing on this screen, so they carry colour; healthy ones stay quiet.
const marginTone = (m: number | null) =>
  m === null ? 'text-muted' : m < 10 ? 'text-red-600' : m < 20 ? 'text-amber-600' : 'text-emerald-700'

// One component for both a product and a sub-product. The only difference is which endpoint it talks
// to, so that is the only thing parameterised — forking it would mean two copies of the permission
// handling, the blank-vs-zero rule and the margin colouring, free to drift apart.
export function ProductCostCard({ productId, variantId, compact }: { productId?: string; variantId?: string; compact?: boolean }) {
  const endpoint = variantId
    ? `/api/catalog/variants/${variantId}/cost`
    : `/api/catalog/products/${productId}/cost`
  const [view, setView] = useState<View | null>(null)
  const [allowed, setAllowed] = useState<boolean | null>(null)   // null = still asking
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Blank strings, not zeros: "nothing recorded" and "recorded as zero" are different facts, and the
  // form must be able to express both.
  const [f, setF] = useState({ primary: '', secondary: '', shipping: '', tariff: '', landed: '' })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(endpoint)
        if (!alive) return
        if (r.status === 403) { setAllowed(false); return }
        if (!r.ok) { setAllowed(false); return }
        const d: View = await r.json()
        setAllowed(true); setView(d)
        if (d.cost) setF({
          primary: d.cost.costPrimary?.toString() ?? '',
          secondary: d.cost.costSecondary?.toString() ?? '',
          shipping: d.cost.shippingCost ? String(d.cost.shippingCost) : '',
          tariff: d.cost.tariffCost ? String(d.cost.tariffCost) : '',
          // One box for businesses that are quoted one number. Seeded with the SUM, so a row recorded
          // before this was switched on still shows what was actually paid.
          landed: d.cost.shippingCost + d.cost.tariffCost ? String(d.cost.shippingCost + d.cost.tariffCost) : '',
        })
      } catch { if (alive) setAllowed(false) }
    })()
    return () => { alive = false }
  }, [endpoint])

  if (allowed !== true || !view) return null

  const { settings, price } = view
  // Markup already snapshotted on this row; today's tenant default only applies to a first save.
  const markup = view.cost?.markupPercent ?? settings.markupPercent

  // Live preview while typing. The saved figure is always the database's generated column — this only
  // has to agree with it, never replace it.
  const primary = num(f.primary)
  // Whichever shape the form is in, this is the same number: the formula sums shipping and tariff
  // BEFORE applying markup, so one combined figure and two separate ones that add to it are
  // arithmetically identical. That is why the merge is input-only and needs no schema change.
  const extras = settings.combineShippingAndDuties
    ? (num(f.landed) ?? 0)
    : (num(f.shipping) ?? 0) + (num(f.tariff) ?? 0)
  const liveTotal = primary === null ? null : (primary + extras) * (1 + markup / 100)
  const liveMargin = liveTotal === null || price === null || price <= 0 ? null : ((price - liveTotal) / price) * 100

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false)
    try {
      const r = await fetch(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        // Every field every time — PUT replaces the row, so omitting one would clear it.
        body: JSON.stringify({
          costPrimary: primary, costSecondary: num(f.secondary),
          ...splitLanded(settings.combineShippingAndDuties, f, view.cost?.tariffCost ?? 0),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not save the cost.')
      setView(d); setSaved(true)
    } catch (e) { setErr((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <section className={compact ? 'rounded-lg border border-hairline bg-sunken/30' : 'rounded-xl border border-hairline-strong bg-white'}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`flex w-full items-center justify-between text-left ${compact ? 'px-3 py-2' : 'p-4'}`}>
        <span className="flex items-center gap-2">
          <h2 className={compact ? 'text-xs font-semibold uppercase tracking-wide text-subtle' : 'font-semibold text-ink'}>Cost &amp; Margin</h2>
          {!open && view.cost?.computedCost != null && (
            <span className="text-sm text-muted">
              {fmt(view.cost.computedCost, settings.baseCurrency)}
              {view.marginPercent !== null && <span className={`ml-2 font-medium ${marginTone(view.marginPercent)}`}>{view.marginPercent.toFixed(1)}%</span>}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className="hidden items-center gap-1 text-xs text-subtle sm:flex"><Lock className="h-3 w-3" /> Only visible to you</span>
          <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className={`space-y-4 border-t border-hairline pt-3 ${compact ? 'px-3 pb-3' : 'px-4 pb-4'}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={`Cost (${settings.baseCurrency})`}>
              <input className={input} inputMode="decimal" value={f.primary} placeholder="—"
                onChange={(e) => { setF((p) => ({ ...p, primary: e.target.value })); setSaved(false) }} />
            </Field>

            {/* Reference only — the supplier's own invoice. Never converted, never part of the total. */}
            {settings.secondaryCurrency && (
              <Field label={`Supplier invoice (${settings.secondaryCurrency})`}>
                <input className={input} inputMode="decimal" value={f.secondary} placeholder="—"
                  onChange={(e) => { setF((p) => ({ ...p, secondary: e.target.value })); setSaved(false) }} />
              </Field>
            )}

            {settings.combineShippingAndDuties ? (
              <Field label="Shipping &amp; duties">
                <input className={input} inputMode="decimal" value={f.landed} placeholder="0"
                  onChange={(e) => { setF((p) => ({ ...p, landed: e.target.value })); setSaved(false) }} />
              </Field>
            ) : (
              <>
                <Field label="Shipping">
                  <input className={input} inputMode="decimal" value={f.shipping} placeholder="0"
                    onChange={(e) => { setF((p) => ({ ...p, shipping: e.target.value })); setSaved(false) }} />
                </Field>
                <Field label="Tariff">
                  <input className={input} inputMode="decimal" value={f.tariff} placeholder="0"
                    onChange={(e) => { setF((p) => ({ ...p, tariff: e.target.value })); setSaved(false) }} />
                </Field>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg bg-sunken/60 px-3 py-2.5">
            <Readout label={`Markup (${markup}%)`} value={primary === null ? '—' : fmt((primary + extras) * (markup / 100), settings.baseCurrency)} />
            <Readout label="Total cost" value={fmt(liveTotal, settings.baseCurrency)} strong />
            <Readout label="Selling price" value={fmt(price, settings.baseCurrency)} />
            <Readout label="Margin" value={liveMargin === null ? '—' : `${liveMargin.toFixed(1)}%`} tone={marginTone(liveMargin)} strong />
          </div>

          {/* Built as whole strings rather than JSX text interleaved with expressions: JSX drops the
              leading space of a text node that follows an expression, which rendered "The EURfigure". */}
          {settings.secondaryCurrency && (
            <p className="text-xs text-subtle">
              {`The ${settings.secondaryCurrency} figure is a reference note from the supplier’s invoice. `}
              {`It is never converted and never counted in the total — record what you actually paid in ${settings.baseCurrency}.`}
            </p>
          )}

          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={saving}
              className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save cost'}
            </button>
            {saved && <span className="text-xs text-emerald-700">Saved.</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
      {children}
    </label>
  )
}

function Readout({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div>
      <span className="block text-xs text-subtle">{label}</span>
      <span className={`${strong ? 'text-base font-semibold' : 'text-sm'} ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  )
}
