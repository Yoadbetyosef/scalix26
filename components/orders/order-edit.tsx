'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/v2/modal'
import { useRouter } from 'next/navigation'
import type { OrderOptionList } from '@/lib/orders/options'
import { ContactPicker, type PickedContact } from './contact-picker'
import { TAX_CHOICES } from '@/lib/tax/canada'
import { LineItemFields, emptyLine, fetchOptionLists, lineFromSaved, lineToPayload, namelessError, type LineDraft } from './line-item-fields'

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
      <button onClick={() => setOpen(true)} className="v2-act">Edit order</button>
      {/* THE APPROVED MODAL, replacing a hand-rolled overlay. Three of these existed in this tree,
          each with slightly different odds and ends — bg-black/40 here, bg-black/30 and a shadow-xl
          there — and none of them trapped focus, closed on Escape, or locked the page behind them.
          `dismissable={!busy}` is the one thing the old overlay did get right: a click outside while
          a save is in flight must not abandon it, and now Escape cannot either. */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissable={!busy}
        title="Edit order"
        wide
        actions={
          <>
            <button onClick={save} disabled={busy} className="v2-act" data-solid>{busy ? 'Saving…' : 'Save changes'}</button>
            <button onClick={() => setOpen(false)} disabled={busy} className="v2-act">Cancel</button>
          </>
        }
      >
        <>
            <p className="v2-hint" style={{ marginBottom: 18 }}>Update the customer, pricing, items and details before sending for approval.</p>

            <div className="space-y-6">
              <section>
                <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Customer</p><s /></div>
                <ContactPicker value={customer} onChange={setCustomer} />
              </section>

              <section>
                <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Order</p><s /></div>
                <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                  <div className="v2-fld"><label htmlFor="oe-order-number">Order number</label><input id="oe-order-number" value={f.orderNumber} onChange={set('orderNumber')} /></div>
                  <div className="v2-fld"><label htmlFor="oe-assigned-to">Assigned to</label><input id="oe-assigned-to" value={f.assignedEmployee} onChange={set('assignedEmployee')} /></div>
                  <div className="v2-fld"><label htmlFor="oe-order-date">Order date</label><input id="oe-order-date" type="date" value={f.orderDate} onChange={set('orderDate')} /></div>
                  <div className="v2-fld"><label htmlFor="oe-requested-completion">Requested completion</label><input id="oe-requested-completion" type="date" value={f.requestedCompletionDate} onChange={set('requestedCompletionDate')} /></div>
                </div>
                <label className="v2-check">
                  <input type="checkbox" checked={isCustomDesign} onChange={(e) => setIsCustomDesign(e.target.checked)} />
                  Custom design
                </label>
              </section>

              {isCustomDesign && (
                <section>
                  <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Client requirements</p><s /></div>
                  <div className="v2-fld"><label htmlFor="oe-brief">The brief</label>
                    <textarea id="oe-brief" value={f.clientRequirements} onChange={set('clientRequirements')} rows={5} placeholder="Style references, budget, deadline, engraving, sizing…" /></div>
                </section>
              )}

              <section>
                <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Factory / Supplier</p><s /></div>
                <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                  <div className="v2-fld"><label htmlFor="oe-factory-name">Factory name</label><input id="oe-factory-name" value={f.factoryName} onChange={set('factoryName')} /></div>
                  <div className="v2-fld"><label htmlFor="oe-contact-name">Contact name</label><input id="oe-contact-name" value={f.factoryContactName} onChange={set('factoryContactName')} /></div>
                  <div className="v2-fld"><label htmlFor="oe-factory-email">Factory email</label><input id="oe-factory-email" value={f.factoryEmail} onChange={set('factoryEmail')} /></div>
                </div>
              </section>

              <section>
                <div className="v2-head" style={{ marginBottom: 12 }}>
                  <p className="v2-kick"><i />Items · {lines.length}</p>
                  <s />
                  <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>Subtotal {sym}{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="space-y-3">
                  {lines.map((l, i) => (
                    <div key={i} className="v2-card" style={{ gap: 0 }}>
                      <LineItemFields line={l} lists={lists} currencySymbol={sym} onChange={(k, v) => setLine(i, k, v)} />
                      <button type="button" onClick={() => setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))} className="v2-act" data-danger style={{ marginTop: 14, alignSelf: 'flex-start' }}>Remove item</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])} className="v2-act">+ Add item</button>
                </div>
              </section>

              <section>
                <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                  <div className="v2-fld"><label htmlFor="oe-deposit">Deposit ({sym})</label>
                    <input id="oe-deposit" value={f.depositAmount} onChange={set('depositAmount')} placeholder="0" /></div>
                  {/* PLACE OF SUPPLY — the destination, not the seller's province. A BC business
                      delivering to Ontario charges 13% HST, and getting this backwards is invisible on
                      the document: the arithmetic looks right, it is just the wrong rate. */}
                  {/* ONE control, not two. Picking the rate sets the place of supply with it, so there
                      is no way to end up with a rate from one province and a destination from another.
                      BC, SK and MB appear twice because both readings are correct and only the seller
                      knows which sale it was — the hint beside each says which, without requiring any
                      tax law to read. */}
                  <div className="v2-fld"><label htmlFor="oe-tax">Tax (delivering to)</label>
                    <span className="v2-sel">
                    <select id="oe-tax" value={f.taxChoiceId} onChange={(e) => setF((p) => ({ ...p, taxChoiceId: e.target.value }))}>
                      <option value="">No tax — nothing shown on the document</option>
                      {TAX_CHOICES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.region} · {c.label} {c.ratePercent}%{c.hint ? ` — ${c.hint}` : ''}
                        </option>
                      ))}
                    </select>
                    </span>
                  </div>
                  {(initial.templates?.length ?? 0) > 0 && (
                    <div className="v2-fld"><label htmlFor="oe-tpl">Document template</label>
                      <span className="v2-sel">
                      <select id="oe-tpl" value={f.documentTemplateId} onChange={(e) => setF((p) => ({ ...p, documentTemplateId: e.target.value }))}>
                        <option value="">Default</option>
                        {initial.templates!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      </span>
                    </div>
                  )}
                  {/* THE EXEMPTION. It is why a GST-only rate was picked, and it is what the customer
                      reads when a BC invoice shows 5% and they know the province charges PST. Nothing
                      here validates a certificate and nothing pretends to — she asserts it, we print
                      it, we keep it. Off by default: an exemption nobody claimed must never appear.
                      The note prints ONLY while the box is ticked, so unticking it removes the claim
                      from the document without destroying what she typed. */}
                  <div className="sm:col-span-3">
                    <label className="v2-check">
                      <input type="checkbox" checked={pstExempt} onChange={(e) => setPstExempt(e.target.checked)} />
                      <span>Provincial tax exempt (resale)<em>Asserted by you and printed as written — nothing here validates a certificate.</em></span>
                    </label>
                    {pstExempt && (
                      <div className="v2-fld" style={{ marginTop: 10 }}>
                        <label htmlFor="oe-pst">Printed under the tax line</label>
                        <input id="oe-pst" value={f.pstExemptionNote} onChange={set('pstExemptionNote')}
                               placeholder="PST exempt — resale certificate on file" />
                      </div>
                    )}
                  </div>
                  <div className="v2-fld"><label htmlFor="oe-public-notes-visible-on-">Public notes (visible on approval page)</label><textarea id="oe-public-notes-visible-on-" value={f.publicNotes} onChange={set('publicNotes')} rows={2} /></div>
                  <div className="v2-fld"><label htmlFor="oe-internal-notes-never-sha">Internal notes (never shared)</label><textarea id="oe-internal-notes-never-sha" value={f.internalNotes} onChange={set('internalNotes')} rows={2} /></div>
                </div>
              </section>
            </div>

            {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 16 }}><p>{err}</p></div>}
        </>
      </Modal>
    </>
  )
}
