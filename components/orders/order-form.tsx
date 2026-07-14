'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Line = { productName: string; description: string; sku: string; quantity: string; unitPrice: string; measurements: string; color: string; material: string; customSpec: string }
const emptyLine = (): Line => ({ productName: '', description: '', sku: '', quantity: '1', unitPrice: '0', measurements: '', color: '', material: '', customSpec: '' })
const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

export function OrderForm() {
  const router = useRouter()
  const [f, setF] = useState({ orderNumber: '', customerName: '', customerEmail: '', customerPhone: '', factoryName: '', factoryContactName: '', factoryEmail: '', assignedEmployee: '', orderDate: '', requestedCompletionDate: '', depositDollars: '0', internalNotes: '', publicNotes: '' })
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const setLine = (i: number, k: keyof Line, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)

  const submit = async () => {
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
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed to create order')
      router.push(`/orders/${j.order.id}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Order number</h3>
        <label className="block max-w-sm text-xs text-gray-500">Optional — leave blank to auto-generate<input value={f.orderNumber} onChange={set('orderNumber')} placeholder="e.g. 1024 or ORD-2026-014" className={inp} /></label>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Customer</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-gray-500">Name<input value={f.customerName} onChange={set('customerName')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Email<input value={f.customerEmail} onChange={set('customerEmail')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Phone<input value={f.customerPhone} onChange={set('customerPhone')} className={inp} /></label>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Factory / Supplier</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-gray-500">Factory name<input value={f.factoryName} onChange={set('factoryName')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Contact name<input value={f.factoryContactName} onChange={set('factoryContactName')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Factory email<input value={f.factoryEmail} onChange={set('factoryEmail')} className={inp} /></label>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Details</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block text-xs text-gray-500">Assigned to<input value={f.assignedEmployee} onChange={set('assignedEmployee')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Order date<input type="date" value={f.orderDate} onChange={set('orderDate')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Requested completion<input type="date" value={f.requestedCompletionDate} onChange={set('requestedCompletionDate')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Deposit ($)<input value={f.depositDollars} onChange={set('depositDollars')} className={inp} /></label>
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">Line items</h3><span className="text-xs text-gray-500">Subtotal ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="block text-xs text-gray-500">Product<input value={l.productName} onChange={(e) => setLine(i, 'productName', e.target.value)} className={inp} /></label>
                <label className="block text-xs text-gray-500">SKU<input value={l.sku} onChange={(e) => setLine(i, 'sku', e.target.value)} className={inp} /></label>
                <label className="block text-xs text-gray-500">Qty<input value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className={inp} /></label>
                <label className="block text-xs text-gray-500">Unit price ($)<input value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} className={inp} /></label>
                <label className="block text-xs text-gray-500">Measurements<input value={l.measurements} onChange={(e) => setLine(i, 'measurements', e.target.value)} className={inp} /></label>
                <label className="block text-xs text-gray-500">Color<input value={l.color} onChange={(e) => setLine(i, 'color', e.target.value)} className={inp} /></label>
                <label className="block text-xs text-gray-500">Material<input value={l.material} onChange={(e) => setLine(i, 'material', e.target.value)} className={inp} /></label>
                <label className="block text-xs text-gray-500">Custom spec<input value={l.customSpec} onChange={(e) => setLine(i, 'customSpec', e.target.value)} className={inp} /></label>
              </div>
              <label className="mt-2 block text-xs text-gray-500">Description<input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} className={inp} /></label>
              {lines.length > 1 && <button onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="mt-2 text-xs text-red-600 hover:underline">Remove item</button>}
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
      <div className="flex gap-2"><button onClick={submit} disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">{busy ? 'Creating…' : 'Create Order'}</button></div>
    </div>
  )
}
