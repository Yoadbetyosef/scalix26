'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/v2/modal'
import { useConfirm } from '@/components/v2/confirm'
import { SupplierPicker, type Supplier } from '@/components/orders/supplier-picker'
import {
  PURCHASE_KINDS, PURCHASE_KIND_LABELS, PURCHASE_STATUSES, PURCHASE_STATUS_LABELS,
  type OrderPurchase, type PurchaseKind, type PurchaseStatus,
} from '@/lib/orders/purchase-types'

// The stone, the mounting, the casting — what was bought to make this piece, from whom, for how
// much, and where it is. Each row moves through its own statuses independently of the order's stage:
// a stone can be received while the mounting is still in production.

const money = (c: number | null, cur: string) => c == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 2 }).format(c / 100)

export function PurchasesPanel({ orderId, currency, purchases, missing, canEdit }: {
  orderId: string; currency: string; purchases: OrderPurchase[]; missing: boolean; canEdit: boolean
}) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [f, setF] = useState({ kind: 'stone' as PurchaseKind, description: '', quantity: '1', cost: '', reference: '', orderedOn: new Date().toISOString().slice(0, 10), expectedOn: '', notes: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }))

  const add = async () => {
    if (!f.description.trim()) { setErr('Describe what was ordered.'); return }
    setBusy('add'); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/purchases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? null,
          kind: f.kind, description: f.description.trim(), quantity: Math.max(1, parseInt(f.quantity, 10) || 1),
          costCents: f.cost.trim() === '' ? null : Math.round((parseFloat(f.cost) || 0) * 100),
          reference: f.reference.trim() || null, status: 'waiting',
          orderedOn: f.orderedOn || null, expectedOn: f.expectedOn || null, notes: f.notes.trim() || null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail || j.error || 'Could not add the purchase.')
      setOpen(false); setF((p) => ({ ...p, description: '', cost: '', reference: '', expectedOn: '', notes: '' })); setSupplier(null)
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const setStatus = async (p: OrderPurchase, status: PurchaseStatus) => {
    setBusy(p.id); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/purchases/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Could not update.')
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const remove = async (p: OrderPurchase) => {
    if (!(await ask({ title: 'Remove this purchase?', body: `${p.description} will be taken off the order. The removal stays on the timeline.`, confirmLabel: 'Remove', danger: true }))) return
    setBusy(p.id); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/purchases/${p.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not remove.')
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const totalCost = purchases.reduce((s, p) => s + (p.costCents ?? 0) * p.quantity, 0)

  return (
    <section>
      <div className="v2-head" style={{ marginBottom: 12 }}>
        <p className="v2-kick"><i />Purchases for this piece · {purchases.length}</p>
        <s />
        {totalCost > 0 && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>Cost {money(totalCost, currency)} · internal</span>}
        {canEdit && !missing && <button type="button" onClick={() => { setErr(null); setOpen(true) }} className="v2-act">Add purchase</button>}
      </div>
      {missing && <div className="v2-card" data-empty><b>Purchases are not enabled on this account yet</b><span>Stones, mountings and castings bought for a piece will be tracked here once the workflow is switched on.</span></div>}
      {!missing && purchases.length === 0 && (
        <div className="v2-card" data-empty><b>Nothing ordered from a supplier yet</b><span>Add the stone, the mounting or the casting as it is ordered, and track it here until it passes QC.</span></div>
      )}
      {purchases.length > 0 && (
        <div className="overflow-x-auto">
          <table className="v2-tbl">
            <thead><tr><th>What</th><th>From</th><th>Cost</th><th>Ordered</th><th>Expected</th><th>Status</th><th /></tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td><div style={{ fontWeight: 500, color: 'var(--v2-ink)' }}>{p.description}</div><div className="v2-hint">{PURCHASE_KIND_LABELS[p.kind]}{p.quantity > 1 ? ` × ${p.quantity}` : ''}{p.reference ? ` · ${p.reference}` : ''}</div></td>
                  <td>{p.supplierName ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.costCents, p.currency)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.orderedOn ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.receivedOn ? `Received ${p.receivedOn}` : (p.expectedOn ?? '—')}</td>
                  <td>
                    {canEdit ? (
                      <span className="v2-sel"><select value={p.status} disabled={busy === p.id} onChange={(e) => setStatus(p, e.target.value as PurchaseStatus)}>
                        {PURCHASE_STATUSES.map((s) => <option key={s} value={s}>{PURCHASE_STATUS_LABELS[s]}</option>)}
                      </select></span>
                    ) : <span className="v2-stat">{PURCHASE_STATUS_LABELS[p.status]}</span>}
                  </td>
                  <td>{canEdit && <button type="button" onClick={() => remove(p)} disabled={busy === p.id} className="v2-act" data-danger style={{ fontSize: 12 }}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && !open && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 12 }}><p>{err}</p></div>}

      <Modal open={open} onClose={() => setOpen(false)} dismissable={busy === null} title="Add a purchase" wide
        actions={<>
          <button onClick={add} disabled={busy !== null} className="v2-act" data-solid>{busy === 'add' ? 'Saving…' : 'Add purchase'}</button>
          <button onClick={() => setOpen(false)} disabled={busy !== null} className="v2-act">Cancel</button>
        </>}>
        <div className="space-y-5">
          <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <div className="v2-fld"><label htmlFor="pu-kind">Kind</label>
              <span className="v2-sel"><select id="pu-kind" value={f.kind} onChange={set('kind')}>{PURCHASE_KINDS.map((k) => <option key={k} value={k}>{PURCHASE_KIND_LABELS[k]}</option>)}</select></span></div>
            <div className="v2-fld" style={{ gridColumn: 'span 2' }}><label htmlFor="pu-desc">What was ordered</label><input id="pu-desc" value={f.description} onChange={set('description')} placeholder="e.g. 1.20ct oval G VS1, GIA" autoFocus /></div>
            <div className="v2-fld"><label htmlFor="pu-qty">Qty</label><input id="pu-qty" value={f.quantity} onChange={set('quantity')} inputMode="numeric" /></div>
            <div className="v2-fld"><label htmlFor="pu-cost">Cost each ({currency.toUpperCase()}) <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)', marginLeft: 6 }}>internal</span></label><input id="pu-cost" value={f.cost} onChange={set('cost')} inputMode="decimal" /></div>
            <div className="v2-fld"><label htmlFor="pu-ref">Vendor ref / PO</label><input id="pu-ref" value={f.reference} onChange={set('reference')} /></div>
            <div className="v2-fld"><label htmlFor="pu-ordered">Ordered on</label><input id="pu-ordered" type="date" value={f.orderedOn} onChange={set('orderedOn')} /></div>
            <div className="v2-fld"><label htmlFor="pu-expected">Expected</label><input id="pu-expected" type="date" value={f.expectedOn} onChange={set('expectedOn')} /></div>
          </div>
          <div>
            <p className="v2-kick" style={{ marginBottom: 8 }}>Supplier</p>
            <SupplierPicker value={supplier} onChange={setSupplier} />
          </div>
          <div className="v2-fld"><label htmlFor="pu-notes">Notes</label><textarea id="pu-notes" value={f.notes} onChange={set('notes')} rows={2} /></div>
          <p className="v2-hint">Upload the supplier&apos;s invoice as an internal attachment on this order; it never reaches a customer document.</p>
        </div>
        {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 12 }}><p>{err}</p></div>}
      </Modal>
      {dialog}
    </section>
  )
}
