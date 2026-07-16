'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Loc = { id: string; name: string; type: string }
type Prod = { id: string; name: string; sku: string | null; price: number | null }
type Item = Record<string, unknown>
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

const SAVE_LABEL: Record<string, string> = { idle: '', saving: 'Saving…', saved: 'Saved', failed: 'Save failed', conflict: 'Changed elsewhere — reload' }

export function DraftEditor({ draftId, initial, initialItems, locations, products, reservationsCount }: {
  draftId: string; initial: Item; initialItems: Item[]; locations: Loc[]; products: Prod[]; reservationsCount: number
}) {
  const router = useRouter()
  const [version, setVersion] = useState<number>(Number(initial.version ?? 1))
  const [customerName, setCustomerName] = useState<string>((initial.customer_name as string) ?? '')
  const [notes, setNotes] = useState<string>((initial.internal_notes as string) ?? '')
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'conflict'>('idle')
  const [addProd, setAddProd] = useState('')
  const [locId, setLocId] = useState(locations[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [reserveMsg, setReserveMsg] = useState<Record<string, string>>({})
  const [converting, setConverting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const converted = initial.status === 'converted'

  const convert = async () => {
    if (!confirm('Convert this draft to a customer order? Reservations transfer to the order.')) return
    setConverting(true)
    try {
      const r = await fetch(`/api/commerce/drafts/${draftId}/convert`, { method: 'POST' })
      const j = await r.json()
      if (r.ok && j.orderId) router.push(`/commerce/orders/${j.orderId}`)
      else { setConverting(false); alert(j.error || 'Could not convert') }
    } catch { setConverting(false) }
  }

  // Version-checked autosave (never reports "saved" before the server confirms).
  const autosave = (patch: Record<string, unknown>) => {
    if (timer.current) clearTimeout(timer.current)
    setSave('saving')
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/commerce/drafts/${draftId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, patch }) })
        if (r.status === 409) { setSave('conflict'); return }
        if (!r.ok) { setSave('failed'); return }
        setVersion((await r.json()).version); setSave('saved')
      } catch { setSave('failed') }
    }, 800)
  }

  const addItem = async () => {
    if (!addProd) return
    setBusy(true)
    try {
      const p = products.find((x) => x.id === addProd)
      await fetch(`/api/commerce/drafts/${draftId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineKind: 'product', productId: addProd, quantity: 1, unitPriceCents: p?.price != null ? Math.round(p.price * 100) : 0 }) })
      setAddProd(''); router.refresh()
    } finally { setBusy(false) }
  }
  const setQty = async (itemId: string, qty: number) => { await fetch(`/api/commerce/drafts/${draftId}/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: qty }) }); router.refresh() }
  const removeItem = async (itemId: string) => { await fetch(`/api/commerce/drafts/${draftId}/items/${itemId}`, { method: 'DELETE' }); router.refresh() }

  const reserve = async (item: Item) => {
    if (!locId) { setReserveMsg((m) => ({ ...m, [item.id as string]: 'Add an inventory location first.' })); return }
    const r = await fetch(`/api/commerce/drafts/${draftId}/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemKind: 'product', itemId: item.product_id, locationId: locId, quantity: Math.max(1, Math.round(Number(item.quantity))) }) })
    const j = await r.json()
    if (j.ok) { setReserveMsg((m) => ({ ...m, [item.id as string]: j.idempotent ? 'Already reserved.' : 'Reserved ✓' })); router.refresh() }
    else if (j.error === 'insufficient' || j.error === 'no_stock') setReserveMsg((m) => ({ ...m, [item.id as string]: `Short: requested ${j.requested}, available ${j.available}, missing ${j.missing}${j.incoming ? `, incoming ${j.incoming}` : ''}${j.expectedArrival ? ` (arrives ${j.expectedArrival})` : ''}` }))
    else setReserveMsg((m) => ({ ...m, [item.id as string]: j.error || 'Could not reserve' }))
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div><div className="font-mono text-xs text-gray-500">{initial.draft_number as string}</div><h1 className="text-2xl font-semibold text-gray-900">{customerName || 'New draft'}</h1></div>
        <span className={`ml-auto text-xs ${save === 'failed' || save === 'conflict' ? 'text-red-600' : 'text-gray-400'}`}>{SAVE_LABEL[save]}{save === 'conflict' && <button onClick={() => router.refresh()} className="ml-2 underline">Reload</button>}</span>
        {converted && initial.converted_order_id ? (
          <button onClick={() => router.push(`/commerce/orders/${initial.converted_order_id}`)} className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50">View order →</button>
        ) : initialItems.length > 0 ? (
          <button onClick={convert} disabled={converting} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">{converting ? 'Converting…' : 'Convert to Order'}</button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Customer + notes */}
        <div className="space-y-3">
          <label className="block text-xs text-gray-500">Customer<input value={customerName} onChange={(e) => { setCustomerName(e.target.value); autosave({ customer_name: e.target.value || null }) }} className={inp} /></label>
          <label className="block text-xs text-gray-500">Internal notes<textarea value={notes} onChange={(e) => { setNotes(e.target.value); autosave({ internal_notes: e.target.value || null }) }} rows={4} className={inp} /></label>
          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">Reserve location:
            <select value={locId} onChange={(e) => setLocId(e.target.value)} className={`${inp} mt-1`}>
              {locations.length === 0 ? <option value="">— none —</option> : locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div className="mt-2">{reservationsCount} active reservation{reservationsCount === 1 ? '' : 's'} on this draft.</div>
          </div>
        </div>

        {/* Line items */}
        <div className="md:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <select value={addProd} onChange={(e) => setAddProd(e.target.value)} className={inp}><option value="">Add a product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}</select>
            <button onClick={addItem} disabled={!addProd || busy} className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
          </div>
          {initialItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">No items yet. Adding an item does not reserve inventory — reserve explicitly when ready.</div>
          ) : (
            <ul className="space-y-2">
              {initialItems.map((it) => (
                <li key={it.id as string} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{(it.description_snapshot as string) || 'Item'}</span>
                    {it.sku_snapshot ? <span className="text-xs text-gray-400">{it.sku_snapshot as string}</span> : null}
                    <input type="number" min={0} defaultValue={Number(it.quantity)} onBlur={(e) => setQty(it.id as string, Math.max(0, Number(e.target.value)))} className="ml-auto w-16 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums" />
                    <span className="w-20 text-right tabular-nums text-gray-700">{money(Number(it.unit_price_cents))}</span>
                    {it.product_id ? <button onClick={() => reserve(it)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Reserve</button> : null}
                    <button onClick={() => removeItem(it.id as string)} className="text-xs text-red-600 hover:underline">Remove</button>
                  </div>
                  {reserveMsg[it.id as string] && <div className="mt-1 text-xs text-gray-500">{reserveMsg[it.id as string]}</div>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-end gap-6 text-sm">
            <span className="text-gray-500">Subtotal <span className="font-medium text-gray-900">{money(Number(initial.subtotal_cents ?? 0))}</span></span>
            <span className="text-gray-500">Total <span className="font-medium text-gray-900">{money(Number(initial.total_cents ?? 0))}</span></span>
          </div>
        </div>
      </div>
    </div>
  )
}
