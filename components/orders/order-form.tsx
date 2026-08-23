'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OrderOptionList } from '@/lib/orders/options'
import { ContactPicker, type PickedContact } from './contact-picker'
import { LineItemFields, emptyLine, fetchOptionLists, lineToPayload, namelessError, type LineDraft } from './line-item-fields'

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'
const SYMBOL: Record<string, string> = { usd: '$', cad: 'CA$', gbp: '£', eur: '€', ils: '₪' }

export function OrderForm() {
  const router = useRouter()
  const [customer, setCustomer] = useState<PickedContact>({ id: null, name: '', email: '', phone: '', address: '', currency: 'usd' })
  const [f, setF] = useState({
    orderNumber: '', factoryName: '', factoryContactName: '', factoryEmail: '', assignedEmployee: '',
    orderDate: '', requestedCompletionDate: '', depositAmount: '', clientRequirements: '', internalNotes: '', publicNotes: '',
  })
  const [isCustomDesign, setIsCustomDesign] = useState(false)
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [lists, setLists] = useState<OrderOptionList[]>([])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)

  useEffect(() => { fetchOptionLists().then(setLists) }, [])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const setLine = (i: number, k: keyof LineDraft, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const sym = SYMBOL[customer.currency] ?? customer.currency.toUpperCase()
  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)

  const submit = async () => {
    // Refused HERE, out loud, rather than dropped on the way to the server. See namelessError.
    const nameless = namelessError(lines)
    if (nameless) { setErr(nameless); return }
    setBusy(true); setErr(null)
    try {
      const body = {
        orderNumber: f.orderNumber.trim() || undefined,
        contactId: customer.id, customerName: customer.name || null, customerEmail: customer.email || null, customerPhone: customer.phone || null,
        currency: customer.currency,
        factoryName: f.factoryName || null, factoryContactName: f.factoryContactName || null, factoryEmail: f.factoryEmail || null,
        assignedEmployee: f.assignedEmployee || null, orderDate: f.orderDate || null, requestedCompletionDate: f.requestedCompletionDate || null,
        depositCents: Math.round((parseFloat(f.depositAmount) || 0) * 100),
        clientRequirements: f.clientRequirements || null, isCustomDesign,
        internalNotes: f.internalNotes || null, publicNotes: f.publicNotes || null,
        lineItems: lines.filter((l) => l.productName.trim()).map(lineToPayload),
      }
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.detail || j.error || 'Failed to create order')
      router.push(`/orders/${j.order.id}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Customer</h3>
        <ContactPicker value={customer} onChange={setCustomer} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Order</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block text-xs text-gray-500">Order number (optional)<input value={f.orderNumber} onChange={set('orderNumber')} placeholder="Auto-generated if blank" className={inp} /></label>
          <label className="block text-xs text-gray-500">Assigned to<input value={f.assignedEmployee} onChange={set('assignedEmployee')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Order date<input type="date" value={f.orderDate} onChange={set('orderDate')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Requested completion<input type="date" value={f.requestedCompletionDate} onChange={set('requestedCompletionDate')} className={inp} /></label>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={isCustomDesign} onChange={(e) => setIsCustomDesign(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Custom design
          <span className="text-xs text-gray-500">— bespoke piece made to the client&apos;s brief</span>
        </label>
      </section>

      {/* Shown once Custom design is ticked — a full brief only matters for bespoke work. */}
      {isCustomDesign && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Client requirements</h3>
          <textarea
            value={f.clientRequirements} onChange={set('clientRequirements')} rows={5}
            placeholder="Everything the client asked for: style references, budget, deadline, engraving, sizing, anything to watch out for…"
            className={inp}
          />
          <p className="mt-1 text-xs text-gray-500">Sketches, reference photos, CAD renders and videos can be attached to the order once it&apos;s created.</p>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Factory / Supplier</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-gray-500">Factory name<input value={f.factoryName} onChange={set('factoryName')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Contact name<input value={f.factoryContactName} onChange={set('factoryContactName')} className={inp} /></label>
          <label className="block text-xs text-gray-500">Factory email<input value={f.factoryEmail} onChange={set('factoryEmail')} className={inp} /></label>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Items</h3>
          <span className="flex items-center gap-3 text-xs text-gray-500">
            <a href="/settings/options" target="_blank" rel="noreferrer" className="hover:underline">Edit dropdown options ↗</a>
            <span>Subtotal {sym}{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </span>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <LineItemFields line={l} lists={lists} currencySymbol={sym} onChange={(k, v) => setLine(i, k, v)} />
              {lines.length > 1 && <button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="mt-2 text-xs text-red-600 hover:underline">Remove item</button>}
            </div>
          ))}
          <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">+ Add item</button>
        </div>
      </section>

      <section>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-gray-500">Deposit ({sym})<input value={f.depositAmount} onChange={set('depositAmount')} placeholder="0" className={inp} /></label>
          <label className="block text-xs text-gray-500">Public notes (visible on approval page)<textarea value={f.publicNotes} onChange={set('publicNotes')} rows={2} className={inp} /></label>
          <label className="block text-xs text-gray-500">Internal notes (never shared)<textarea value={f.internalNotes} onChange={set('internalNotes')} rows={2} className={inp} /></label>
        </div>
      </section>

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">{busy ? 'Creating…' : 'Create Order'}</button>
      </div>
    </div>
  )
}
