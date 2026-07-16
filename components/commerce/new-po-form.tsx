'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Supplier = { id: string; company_name: string }
type Product = { id: string; name: string; sku: string | null }
type Line = { key: number; productId: string; description: string; sku: string; quantity: string; unitCost: string }

const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'
let nextKey = 1
const blank = (): Line => ({ key: nextKey++, productId: '', description: '', sku: '', quantity: '1', unitCost: '' })

export function NewPoForm({ suppliers, products }: { suppliers: Supplier[]; products: Product[] }) {
  const router = useRouter()
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<Line[]>([blank()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickProduct = (key: number, pid: string) => {
    const p = products.find((x) => x.id === pid)
    setLine(key, { productId: pid, description: p ? p.name : '', sku: p?.sku ?? '' })
  }
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls))

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * Math.round((Number(l.unitCost) || 0) * 100), 0)

  const submit = async () => {
    const items = lines
      .map((l) => ({
        productId: l.productId || null,
        description: l.description.trim() || null,
        sku: l.sku.trim() || null,
        quantity: Number(l.quantity),
        unitCostCents: Math.round((Number(l.unitCost) || 0) * 100),
        isCustom: !l.productId,
      }))
      .filter((i) => i.quantity > 0 && (i.description || i.productId))
    if (!items.length) { setErr('Add at least one item with a description and quantity.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/commerce/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierId: supplierId || null, items }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      router.push(`/commerce/purchase-orders/${j.po.id}`)
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <label className="block max-w-sm text-xs text-gray-500">Supplier (optional)
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`mt-0.5 ${inp}`}>
          <option value="">— none —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
        </select>
      </label>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="hidden gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-medium text-gray-500 sm:flex">
          <span className="flex-1">Item</span><span className="w-24 text-right">Qty</span><span className="w-28 text-right">Unit cost ($)</span><span className="w-8" />
        </div>
        {lines.map((l) => (
          <div key={l.key} className="flex flex-wrap items-start gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0">
            <div className="flex-1 space-y-1">
              {products.length > 0 && (
                <select value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)} className={inp}>
                  <option value="">Custom item (free text)…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
                </select>
              )}
              <input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Description" className={inp} />
            </div>
            <input type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={`w-24 ${inp}`} />
            <input type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => setLine(l.key, { unitCost: e.target.value })} placeholder="0.00" className={`w-28 ${inp}`} />
            <button onClick={() => removeLine(l.key)} disabled={lines.length === 1} className="mt-1 h-8 w-8 rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-30" aria-label="Remove line">✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setLines((ls) => [...ls, blank()])} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">+ Add line</button>
        <div className="text-sm text-gray-500">Subtotal <span className="ml-2 font-semibold tabular-nums text-gray-900">${(subtotal / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Creating…' : 'Create purchase order'}</button>
        <button onClick={() => router.push('/commerce/purchase-orders')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
      </div>
      <p className="text-[11px] text-gray-400">POs of $500+ or with custom items require approval before they can be sent to a supplier.</p>
    </div>
  )
}
