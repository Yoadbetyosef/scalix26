'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OrderOptionList } from '@/lib/orders/options'
import { ContactPicker, type PickedContact } from './contact-picker'
import { LineItemFields, emptyLine, fetchOptionLists, lineToPayload, namelessError, type LineDraft } from './line-item-fields'

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
    <div className="v2 v2-embedded space-y-7">
      {/* The kit's alert row, not a red block — the same treatment the takeover banner and the
          duplicate-contact warning got. */}
      {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><p>{err}</p></div>}

      {/* Each section is a micro-label and a rule, which is what this language uses for a heading
          everywhere else. v1 used a 14px bold h3, so a form of six sections had six bold lines
          competing with the field labels under them. */}
      <section>
        <div className="v2-head" style={{ marginBottom: 14 }}><p className="v2-kick"><i />Customer</p><s /></div>
        <ContactPicker value={customer} onChange={setCustomer} />
      </section>

      <section>
        <div className="v2-head" style={{ marginBottom: 14 }}><p className="v2-kick"><i />Order</p><s /></div>
        {/* Rule, not box. The label sits above its own rule and the value is typed on it — which is
            also why the label can no longer wrap the input: .v2-fld needs them as siblings. */}
        <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="v2-fld"><label htmlFor="of-num">Order number</label>
            <input id="of-num" value={f.orderNumber} onChange={set('orderNumber')} placeholder="Auto-generated if blank" /></div>
          <div className="v2-fld"><label htmlFor="of-assigned">Assigned to</label>
            <input id="of-assigned" value={f.assignedEmployee} onChange={set('assignedEmployee')} /></div>
          <div className="v2-fld"><label htmlFor="of-date">Order date</label>
            <input id="of-date" type="date" value={f.orderDate} onChange={set('orderDate')} /></div>
          <div className="v2-fld"><label htmlFor="of-req">Requested completion</label>
            <input id="of-req" type="date" value={f.requestedCompletionDate} onChange={set('requestedCompletionDate')} /></div>
        </div>
        <label className="v2-check">
          <input type="checkbox" checked={isCustomDesign} onChange={(e) => setIsCustomDesign(e.target.checked)} />
          <span>Custom design<em>bespoke piece made to the client&apos;s brief</em></span>
        </label>
      </section>

      {/* Shown once Custom design is ticked — a full brief only matters for bespoke work. */}
      {isCustomDesign && (
        <section>
          <div className="v2-head" style={{ marginBottom: 14 }}><p className="v2-kick"><i />Client requirements</p><s /></div>
          <div className="v2-fld">
            <label htmlFor="of-req-text">The brief</label>
            <textarea id="of-req-text" value={f.clientRequirements} onChange={set('clientRequirements')} rows={5}
              placeholder="Everything the client asked for: style references, budget, deadline, engraving, sizing, anything to watch out for…" />
            <span className="v2-hint">Sketches, reference photos, CAD renders and videos can be attached to the order once it&apos;s created.</span>
          </div>
        </section>
      )}

      <section>
        <div className="v2-head" style={{ marginBottom: 14 }}><p className="v2-kick"><i />Factory / supplier</p><s /></div>
        <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="v2-fld"><label htmlFor="of-fname">Factory name</label>
            <input id="of-fname" value={f.factoryName} onChange={set('factoryName')} /></div>
          <div className="v2-fld"><label htmlFor="of-fcontact">Contact name</label>
            <input id="of-fcontact" value={f.factoryContactName} onChange={set('factoryContactName')} /></div>
          <div className="v2-fld"><label htmlFor="of-femail">Factory email</label>
            <input id="of-femail" value={f.factoryEmail} onChange={set('factoryEmail')} /></div>
        </div>
      </section>

      <section>
        <div className="v2-head" style={{ marginBottom: 14 }}>
          <p className="v2-kick"><i />Items · {lines.length}</p>
          <s />
          <a href="/settings/options" target="_blank" rel="noreferrer" className="v2-act">Dropdown options ↗</a>
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>
            Subtotal {sym}{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="v2-card" style={{ gap: 0 }}>
              <LineItemFields line={l} lists={lists} currencySymbol={sym} onChange={(k, v) => setLine(i, k, v)} />
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                        className="v2-act" data-danger style={{ marginTop: 14, alignSelf: 'flex-start' }}>
                  Remove item
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])} className="v2-act">+ Add item</button>
        </div>
      </section>

      <section>
        <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div className="v2-fld"><label htmlFor="of-dep">Deposit ({sym})</label>
            <input id="of-dep" value={f.depositAmount} onChange={set('depositAmount')} placeholder="0" /></div>
          <div className="v2-fld"><label htmlFor="of-pub">Public notes</label>
            <textarea id="of-pub" value={f.publicNotes} onChange={set('publicNotes')} rows={2} />
            <span className="v2-hint">Visible on the approval page.</span></div>
          <div className="v2-fld"><label htmlFor="of-int">Internal notes</label>
            <textarea id="of-int" value={f.internalNotes} onChange={set('internalNotes')} rows={2} />
            <span className="v2-hint">Never shared.</span></div>
        </div>
      </section>

      <div className="v2-bar">
        <button onClick={submit} disabled={busy} className="v2-act" data-solid>{busy ? 'Creating…' : 'Create order'}</button>
      </div>
    </div>
  )
}
