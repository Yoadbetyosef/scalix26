'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Loc = { id: string; name: string; type: string }
type Prod = { id: string; name: string; sku: string | null }
const inp = 'rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'
const LOC_TYPES = ['warehouse', 'showroom', 'floor_display', 'reserved', 'damaged', 'in_transit']

export function InventoryPanel({ locations, products }: { locations: Loc[]; products: Prod[] }) {
  const router = useRouter()
  const [ln, setLn] = useState({ name: '', type: 'warehouse' })
  const [stk, setStk] = useState({ productId: products[0]?.id ?? '', locationId: locations[0]?.id ?? '', qty: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const addLoc = async () => {
    if (!ln.name.trim()) return
    setBusy(true); setMsg(null)
    try { const r = await fetch('/api/commerce/inventory/locations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ln) }); if (!r.ok) throw new Error((await r.json()).error); setLn({ name: '', type: 'warehouse' }); router.refresh() } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const setStock = async () => {
    if (!stk.productId || !stk.locationId || !stk.qty) { setMsg('Pick a product, a location, and a quantity.'); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/commerce/inventory/movement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemKind: 'product', itemId: stk.productId, locationId: stk.locationId, movementType: 'opening_balance', delta: Math.round(Number(stk.qty)), field: 'on_hand', reason: 'opening balance' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setMsg(`On-hand: ${j.before} → ${j.after}`); setStk((s) => ({ ...s, qty: '' })); router.refresh()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Locations</h3>
        <ul className="mb-3 space-y-1 text-sm">
          {locations.length === 0 ? <li className="text-gray-400">No locations yet.</li> : locations.map((l) => <li key={l.id} className="flex justify-between"><span className="text-gray-800">{l.name}</span><span className="text-xs text-gray-400">{l.type.replace(/_/g, ' ')}</span></li>)}
        </ul>
        <div className="flex gap-2">
          <input value={ln.name} onChange={(e) => setLn((p) => ({ ...p, name: e.target.value }))} placeholder="Location name" className={`${inp} flex-1`} />
          <select value={ln.type} onChange={(e) => setLn((p) => ({ ...p, type: e.target.value }))} className={inp}>{LOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select>
          <button onClick={addLoc} disabled={busy || !ln.name.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Set opening stock</h3>
        <p className="mb-3 text-xs text-gray-500">Every change writes an immutable ledger movement.</p>
        <div className="space-y-2">
          <select value={stk.productId} onChange={(e) => setStk((s) => ({ ...s, productId: e.target.value }))} className={`${inp} w-full`}><option value="">Product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}</select>
          <select value={stk.locationId} onChange={(e) => setStk((s) => ({ ...s, locationId: e.target.value }))} className={`${inp} w-full`}><option value="">Location…</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <div className="flex gap-2"><input value={stk.qty} onChange={(e) => setStk((s) => ({ ...s, qty: e.target.value }))} placeholder="Quantity" className={`${inp} flex-1`} /><button onClick={setStock} disabled={busy} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Set on-hand</button></div>
        </div>
      </div>
      {msg && <div className="text-xs text-gray-600 md:col-span-2">{msg}</div>}
    </div>
  )
}
