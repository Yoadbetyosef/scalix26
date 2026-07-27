'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { StudioProduct, StudioVariant, StudioDocType } from '@/lib/studio/types'
import { DOC_META, variantPrice, variantTitle } from '@/lib/studio/types'

const input = 'h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const money = (n: number | null) => (n != null ? `$${Number(n).toLocaleString()}` : '—')

type Line = { ref: string; name: string; sub: string | null; unit: number | null; qty: number }

export function DocumentCreator({ product, variants, type, onClose }: {
  product: StudioProduct
  variants: StudioVariant[]
  type: StudioDocType
  onClose: () => void
}) {
  const meta = DOC_META[type]
  const isProduction = type === 'production'

  const [lines, setLines] = useState<Line[]>(() => [
    { ref: 'product', name: product.name, sub: 'Base product', unit: product.base_price, qty: variants.length ? 0 : 1 },
    ...variants.map((v) => ({
      ref: v.id, name: variantTitle(v),
      sub: v.fabric_name ? `${v.fabric_family} · ${v.fabric_name}` : null,
      unit: variantPrice(product, v), qty: 0,
    })),
  ])
  const [party, setParty] = useState(isProduction ? product.supplier_name || '' : '')
  const [email, setEmail] = useState(isProduction ? product.supplier_email || '' : '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setQty = (ref: string, qty: number) => setLines((ls) => ls.map((l) => (l.ref === ref ? { ...l, qty: Math.max(0, qty) } : l)))
  const chosen = lines.filter((l) => l.qty > 0)
  const subtotal = chosen.reduce((s, l) => s + (l.unit || 0) * l.qty, 0)

  async function create() {
    if (chosen.length === 0) { setErr('Pick at least one item'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/studio/products/${product.id}/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, party_name: party, party_email: email, notes, items: chosen.map((l) => ({ ref: l.ref, qty: l.qty })) }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      window.open(`/d/${d.document.token}`, '_blank')
      onClose()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">New {meta.noun}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunken"><X className="h-5 w-5" /></button>
        </div>

        {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        {/* Items + quantities */}
        <div className="mb-4 rounded-xl border border-hairline-strong">
          <p className="border-b border-hairline px-3 py-2 text-xs font-medium uppercase tracking-wide text-subtle">Items & quantities</p>
          <div className="divide-y divide-hairline">
            {lines.map((l) => (
              <div key={l.ref} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{l.name}</p>
                  <p className="truncate text-xs text-muted">{[l.sub, !isProduction ? money(l.unit) : null].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button onClick={() => setQty(l.ref, l.qty - 1)} className="h-8 w-8 rounded-lg border border-hairline-strong text-ink">−</button>
                  <input className="h-8 w-12 rounded-lg border border-hairline-strong text-center text-sm outline-none focus:border-accent" type="number" min={0} value={l.qty} onChange={(e) => setQty(l.ref, Math.trunc(Number(e.target.value)))} />
                  <button onClick={() => setQty(l.ref, l.qty + 1)} className="h-8 w-8 rounded-lg border border-hairline-strong text-ink">+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{meta.party} name</span>
            <input className={input} value={party} onChange={(e) => setParty(e.target.value)} placeholder={isProduction ? 'Factory / supplier' : 'Client name'} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{meta.party} email (optional)</span>
            <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Notes (optional)</span>
            <textarea className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between">
          {!isProduction ? <span className="text-sm text-muted">Subtotal <span className="text-base font-bold text-ink">${subtotal.toLocaleString()}</span></span> : <span className="text-sm text-muted">{chosen.length} item{chosen.length === 1 ? '' : 's'}</span>}
          <button onClick={create} disabled={busy} className="h-11 rounded-lg bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Creating…' : `Create ${meta.noun}`}</button>
        </div>
        <p className="mt-2 text-center text-xs text-muted">Opens a shareable, printable page.</p>
      </div>
    </div>
  )
}
