'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OrderOptionList } from '@/lib/orders/options'
import { ContactPicker, type PickedContact } from './contact-picker'
import { TAX_CHOICES } from '@/lib/tax/canada'
import { LineItemFields, emptyLine, fetchOptionLists, lineFromSaved, lineToPayload, namelessError, type LineDraft } from './line-item-fields'

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'
const SYMBOL: Record<string, string> = { usd: '$', cad: 'CA$', gbp: '£', eur: '€', ils: '₪' }

export interface OrderEditInitial {
  orderNumber: string
  contactId: string | null
  customerName: string | null; customerEmail: string | null; customerPhone: string | null
  factoryName: string | null; factoryContactName: string | null; factoryEmail: string | null
  assignedEmployee: string | null; orderDate: string | null; requestedCompletionDate: string | null
  depositCents: number; currency: string
  deliveryProvince?: string | null
  taxKind?: 'gst_only' | 'combined' | null
  pstExempt?: boolean
  pstExemptionNote?: string | null
  documentTemplateId?: string | null
  templates?: Array<{ id: string; name: string }>
  clientRequirements: string | null; isCustomDesign: boolean
  internalNotes: string | null; publicNotes: string | null
  lineItems: Array<Parameters<typeof lineFromSaved>[0]>
}

// Edit an EXISTING order's customer / pricing / line items / details after creation — e.g. after the
// factory quotes a cost, before sending to the customer for approval. Saves via PATCH /api/orders/[id],
// which re-prices the subtotal/balance. Does NOT touch estimated_completion_date (set by the factory).
export function OrderEdit({ orderId, initial }: { orderId: string; initial: OrderEditInitial }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [lists, setLists] = useState<OrderOptionList[]>([])

  const [customer, setCustomer] = useState<PickedContact>({
    id: initial.contactId, name: initial.customerName ?? '', email: initial.customerEmail ?? '',
    phone: initial.customerPhone ?? '', address: '', currency: initial.currency || 'usd',
  })
  const [f, setF] = useState({
    orderNumber: initial.orderNumber ?? '',
    factoryName: initial.factoryName ?? '', factoryContactName: initial.factoryContactName ?? '', factoryEmail: initial.factoryEmail ?? '',
    assignedEmployee: initial.assignedEmployee ?? '', orderDate: initial.orderDate ?? '', requestedCompletionDate: initial.requestedCompletionDate ?? '',
    depositAmount: initial.depositCents ? (initial.depositCents / 100).toString() : '',
    // The stored choice, reconstructed. A province with a kind is one of the split rows; a province
    // without one is a province that has only a single reading — see TAX_CHOICES.
    taxChoiceId: initial.deliveryProvince
      ? (initial.taxKind ? `${initial.deliveryProvince}:${initial.taxKind}` : initial.deliveryProvince)
      : '',
    pstExemptionNote: initial.pstExemptionNote ?? '',
    documentTemplateId: initial.documentTemplateId ?? '',
    clientRequirements: initial.clientRequirements ?? '', internalNotes: initial.internalNotes ?? '', publicNotes: initial.publicNotes ?? '',
  })
  const [isCustomDesign, setIsCustomDesign] = useState(initial.isCustomDesign)
  const [pstExempt, setPstExempt] = useState(initial.pstExempt === true)
  const [lines, setLines] = useState<LineDraft[]>(initial.lineItems.length ? initial.lineItems.map(lineFromSaved) : [emptyLine()])

  // Only fetch the dropdown lists once the dialog is actually opened.
  useEffect(() => { if (open && !lists.length) fetchOptionLists().then(setLists) }, [open, lists.length])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const setLine = (i: number, k: keyof LineDraft, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const sym = SYMBOL[customer.currency] ?? customer.currency.toUpperCase()
  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)

  const save = async () => {
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
        // The ID only. The server reads province, label and rate off TAX_CHOICES — a client that could
        // post its own percentage could put 3% on a customer's invoice and it would look ordinary.
        // Empty means no tax line at all rather than a 0%, which would be a claim that none is due.
        taxChoiceId: f.taxChoiceId || null,
        pstExempt,
        pstExemptionNote: f.pstExemptionNote.trim() || null,
        documentTemplateId: f.documentTemplateId || null,
        clientRequirements: f.clientRequirements || null, isCustomDesign,
        internalNotes: f.internalNotes || null, publicNotes: f.publicNotes || null,
        lineItems: lines.filter((l) => l.productName.trim()).map(lineToPayload),
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
          <div className="my-8 w-full max-w-3xl rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Edit order</h3>
            <p className="mt-0.5 text-xs text-gray-500">Update the customer, pricing, items and details before sending for approval.</p>

            <div className="mt-4 space-y-5">
              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Customer</h4>
                <ContactPicker value={customer} onChange={setCustomer} />
              </section>

              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Order</h4>
                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="block text-xs text-gray-500">Order number<input value={f.orderNumber} onChange={set('orderNumber')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Assigned to<input value={f.assignedEmployee} onChange={set('assignedEmployee')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Order date<input type="date" value={f.orderDate} onChange={set('orderDate')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Requested completion<input type="date" value={f.requestedCompletionDate} onChange={set('requestedCompletionDate')} className={inp} /></label>
                </div>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={isCustomDesign} onChange={(e) => setIsCustomDesign(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                  Custom design
                </label>
              </section>

              {isCustomDesign && (
                <section>
                  <h4 className="mb-2 text-sm font-semibold text-gray-900">Client requirements</h4>
                  <textarea value={f.clientRequirements} onChange={set('clientRequirements')} rows={5} placeholder="Style references, budget, deadline, engraving, sizing…" className={inp} />
                </section>
              )}

              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Factory / Supplier</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs text-gray-500">Factory name<input value={f.factoryName} onChange={set('factoryName')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Contact name<input value={f.factoryContactName} onChange={set('factoryContactName')} className={inp} /></label>
                  <label className="block text-xs text-gray-500">Factory email<input value={f.factoryEmail} onChange={set('factoryEmail')} className={inp} /></label>
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">Items</h4>
                  <span className="text-xs text-gray-500">Subtotal {sym}{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="space-y-3">
                  {lines.map((l, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3">
                      <LineItemFields line={l} lists={lists} currencySymbol={sym} onChange={(k, v) => setLine(i, k, v)} />
                      <button type="button" onClick={() => setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))} className="mt-2 text-xs text-red-600 hover:underline">Remove item</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">+ Add item</button>
                </div>
              </section>

              <section>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs text-gray-500">Deposit ({sym})<input value={f.depositAmount} onChange={set('depositAmount')} placeholder="0" className={inp} /></label>
                  {/* PLACE OF SUPPLY — the destination, not the seller's province. A BC business
                      delivering to Ontario charges 13% HST, and getting this backwards is invisible on
                      the document: the arithmetic looks right, it is just the wrong rate. */}
                  {/* ONE control, not two. Picking the rate sets the place of supply with it, so there
                      is no way to end up with a rate from one province and a destination from another.
                      BC, SK and MB appear twice because both readings are correct and only the seller
                      knows which sale it was — the hint beside each says which, without requiring any
                      tax law to read. */}
                  <label className="block text-xs text-gray-500">Tax (delivering to)
                    <select value={f.taxChoiceId} onChange={(e) => setF((p) => ({ ...p, taxChoiceId: e.target.value }))} className={inp}>
                      <option value="">No tax — nothing shown on the document</option>
                      {TAX_CHOICES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.region} · {c.label} {c.ratePercent}%{c.hint ? ` — ${c.hint}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(initial.templates?.length ?? 0) > 0 && (
                    <label className="block text-xs text-gray-500">Document template
                      <select value={f.documentTemplateId} onChange={(e) => setF((p) => ({ ...p, documentTemplateId: e.target.value }))} className={inp}>
                        <option value="">Default</option>
                        {initial.templates!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  )}
                  {/* THE EXEMPTION. It is why a GST-only rate was picked, and it is what the customer
                      reads when a BC invoice shows 5% and they know the province charges PST. Nothing
                      here validates a certificate and nothing pretends to — she asserts it, we print
                      it, we keep it. Off by default: an exemption nobody claimed must never appear.
                      The note prints ONLY while the box is ticked, so unticking it removes the claim
                      from the document without destroying what she typed. */}
                  <div className="sm:col-span-3">
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <input type="checkbox" checked={pstExempt} onChange={(e) => setPstExempt(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
                      Provincial tax exempt (resale)
                    </label>
                    {pstExempt && (
                      <label className="mt-2 block text-xs text-gray-500">Printed under the tax line
                        <input
                          value={f.pstExemptionNote}
                          onChange={set('pstExemptionNote')}
                          placeholder="PST exempt — resale certificate on file"
                          className={inp}
                        />
                      </label>
                    )}
                  </div>
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
