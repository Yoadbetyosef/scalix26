'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Line = { productName: string; description: string; sku: string; quantity: string; unitPrice: string; measurements: string; color: string; material: string; customSpec: string }
const emptyLine = (): Line => ({ productName: '', description: '', sku: '', quantity: '1', unitPrice: '0', measurements: '', color: '', material: '', customSpec: '' })
const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

export interface OrderEditInitial {
  orderNumber: string
  customerName: string | null; customerEmail: string | null; customerPhone: string | null
  factoryName: string | null; factoryContactName: string | null; factoryEmail: string | null
  assignedEmployee: string | null; orderDate: string | null; requestedCompletionDate: string | null
  depositCents: number; currency: string; internalNotes: string | null; publicNotes: string | null
  lineItems: Array<{ productName: string; description: string | null; sku: string | null; quantity: number; unitPriceCents: number; measurements: string | null; color: string | null; material: string | null; customSpec: string | null }>
}

// Edit an EXISTING order's pricing / line items / details after creation — e.g. after the factory
// quotes a cost, before sending to the customer for approval. Saves via PATCH /api/orders/[id],
// which re-prices the subtotal/balance. Does NOT touch estimated_completion_date (set by the factory).
export function OrderEdit({ orderId, initial }: { orderId: string; initial: OrderEditInitial }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({
    orderNumber: initial.orderNumber ?? '',
    customerName: initial.customerName ?? '', customerEmail: initial.customerEmail ?? '', customerPhone: initial.customerPhone ?? '',
    factoryName: initial.factoryName ?? '', factoryContactName: initial.factoryContactName ?? '', factoryEmail: initial.factoryEmail ?? '',
    assignedEmployee: initial.assignedEmployee ?? '', orderDate: initial.orderDate ?? '', requestedCompletionDate: initial.requestedCompletionDate ?? '',
    depositDollars: (initial.depositCents / 100).toString(), internalNotes: initial.internalNotes ?? '', publicNotes: initial.publicNotes ?? '',
  })
  const [lines, setLines] = useState<Line[]>(
    initial.lineItems.length
      ? initial.lineItems.map((l) => ({ productName: l.productName, description: l.description ?? '', sku: l.sku ?? '', quantity: String(l.quantity), unitPrice: (l.unitPriceCents / 100).toString(), measurements: l.measurements ?? '', color: l.color ?? '', material: l.material ?? '', customSpec: l.customSpec ?? '' }))
      : [emptyLine()],
  )
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const setLine = (i: number, k: keyof Line, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const cur = initial.currency === 'usd' || initial.currency === 'USD' ? '$' : ''
  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const body = {
        orderNumber: f.orderNumber.trim() || undefined,
        customerName: f.customerName || null, customerEmail: f.customerEmail || null, customerPhone: f.customerPhone || null,
        factoryName: f.factoryName || null, factoryContactName: f.factoryContactName || null, factoryEmail: f.factoryEmail || null,
        assignedEmployee: f.assignedEmployee || null, orderDate: f.orderDate || null, requestedCompletionDate: f.requestedCompletionDate || null,
        depositCents: Math.round((parseFloat(f.depositDollars) || 0) * 100), internalNotes: f.internalNotes || null, publicNotes: f.publicNotes || null,
        lineItems: lines.filter((l) => l.productName.trim()).map((l) => ({ productName: l.productName, description: l.description || null, sku: l.sku || null, quantity: parseFloat(l.quantity) || 1, unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100), measurements: l.measurements || null, color: l.color || null, material: l.material || null, customSpec: l.customSpec || null })),
      }
      const r = await fetch(`/api/orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.detail || j.error || 'Failed to save')
      setOpen(false); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Edit order</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Edit order</h3>
            <p className="mt-0.5 text-xs text-gray-500">Update pricing, line items, and details before sending for approval.</p>

            <div className="mt-4 space-y-5">
              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Order number</h4>
                <label className="block max-w-xs text-xs text-gray-500">Order number<input value={f.orderNumber} onChange={set('orderNumber')} className={inp} /></label>
              </section>
              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Customer</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs text-gray-500">Name<input value={f.customerName} onChange={set('customerName')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Email<input value={f.customerEmail} onChange={set('customerEmail')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Phone<input value={f.customerPhone} onChange={set('customerPhone')} className={inp} /></label>
                </div>
              </section>
              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Factory / Supplier</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs text-gray-500">Factory name<input value={f.factoryName} onChange={set('factoryName')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Contact name<input value={f.factoryContactName} onChange={set('factoryContactName')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Factory email<input value={f.factoryEmail} onChange={set('factoryEmail')} className={inp} /></label>
                </div>
              </section>
              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Details</h4>
                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="block text-xs text-gray-500">Assigned to<input value={f.assignedEmployee} onChange={set('assignedEmployee')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Order date<input type="date" value={f.orderDate} onChange={set('orderDate')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Requested completion<input type="date" value={f.requestedCompletionDate} onChange={set('requestedCompletionDate')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Deposit ({cur || initial.currency})<input value={f.depositDollars} onChange={set('depositDollars')} className={inp} /></label>
                </div>
              </section>
              <section>
                <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold text-gray-900">Line items</h4><span className="text-xs text-gray-500">Subtotal {cur}{total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                <div className="space-y-3">
                  {lines.map((l, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3">
                      <div className="grid gap-2 sm:grid-cols-4">
                        <label className="block text-xs text-gray-500">Product<input value={l.productName} onChange={(e) => setLine(i, 'productName', e.target.value)} className={inp} /></label>
                        <label className="block text-xs text-gray-500">SKU<input value={l.sku} onChange={(e) => setLine(i, 'sku', e.target.value)} className={inp} /></label>
                        <label className="block text-xs text-gray-500">Qty<input value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className={inp} /></label>
                        <label className="block text-xs text-gray-500">Unit price ({cur || initial.currency})<input value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} className={inp} /></label>
                        <label className="block text-xs text-gray-500">Measurements<input value={l.measurements} onChange={(e) => setLine(i, 'measurements', e.target.value)} className={inp} /></label>
                        <label className="block text-xs text-gray-500">Color<input value={l.color} onChange={(e) => setLine(i, 'color', e.target.value)} className={inp} /></label>
                        <label className="block text-xs text-gray-500">Material<input value={l.material} onChange={(e) => setLine(i, 'material', e.target.value)} className={inp} /></label>
                        <label className="block text-xs text-gray-500">Custom spec<input value={l.customSpec} onChange={(e) => setLine(i, 'customSpec', e.target.value)} className={inp} /></label>
                      </div>
                      <label className="mt-2 block text-xs text-gray-500">Description<input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} className={inp} /></label>
                      <button onClick={() => setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))} className="mt-2 text-xs text-red-600 hover:underline">Remove item</button>
                    </div>
                  ))}
                  <button onClick={() => setLines((p) => [...p, emptyLine()])} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">+ Add line item</button>
                </div>
              </section>
              <section>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-gray-500">Public notes (visible on approval page)<textarea value={f.publicNotes} onChange={set('publicNotes')} rows={2} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Internal notes (never shared)<textarea value={f.internalNotes} onChange={set('internalNotes')} rows={2} className={inp} /></label>
                </div>
              </section>
            </div>

            {err && <div className="mt-3 text-xs text-red-600">{err}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">{busy ? 'Saving…' : 'Save changes'}</button>
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
