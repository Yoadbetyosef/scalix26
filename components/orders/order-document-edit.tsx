'use client'

import { useState } from 'react'
import { Modal } from '@/components/v2/modal'
import { useRouter } from 'next/navigation'
import { TAX_CHOICES } from '@/lib/tax/canada'

// TAX ON A JOB THAT IS ALREADY FINISHED.
//
// The full edit drawer closes when an order reaches a terminal stage, and that is right for almost
// everything in it — customer, factory, dates, line items. It was wrong for two things.
//
// Tax is the fact most likely to be missing at the moment a job ends: thirteen of TG jewellers'
// fifteen orders reached that point carrying none at all. With the drawer shut, the only way to put a
// rate on the invoice was to move the order backwards out of `finished` — a lie about the workflow,
// told to fix a number. (The invoice photograph had the same problem and never had it: the
// attachments panel was never gated, so "Use on the invoice" has always worked here.)
//
// ── WHY THIS IS ITS OWN FORM AND NOT THE DRAWER UNLOCKED ────────────────────────────────────────
//
// The drawer always posts `lineItems`, and updateOrder recomputes subtotal_cents and balance_cents
// whenever that key is present. So opening it on a finished order and pressing Save would RE-PRICE an
// invoice a customer already holds, even if the only thing touched was the tax. This form posts three
// keys and nothing else, so there is no path from here to a price.
//
// The route enforces the same rule independently — see PATCH /api/orders/[id]. A hidden button is not
// a gate; that is what the old one was.

export function OrderDocumentEdit({
  orderId, stage, initial,
}: {
  orderId: string
  stage: string
  initial: {
    deliveryProvince?: string | null
    taxKind?: 'gst_only' | 'combined' | null
    pstExempt?: boolean
    pstExemptionNote?: string | null
  }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The stored choice, reconstructed. A province with a kind is one of the split rows (BC/SK/MB);
  // without one it is a province that has only a single reading. Same rule as the full drawer.
  const [choice, setChoice] = useState(
    initial.deliveryProvince
      ? (initial.taxKind ? `${initial.deliveryProvince}:${initial.taxKind}` : initial.deliveryProvince)
      : '',
  )
  const [exempt, setExempt] = useState(initial.pstExempt === true)
  const [note, setNote] = useState(initial.pstExemptionNote ?? '')

  async function save() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // THREE KEYS. No lineItems, so nothing re-prices.
        body: JSON.stringify({
          taxChoiceId: choice || null,
          pstExempt: exempt,
          pstExemptionNote: note.trim() || null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'That could not be saved.'); return }
      setOpen(false)
      router.refresh()
    } catch {
      setErr('That could not be saved — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="v2-act">Edit tax</button>

      {/* The third hand-rolled overlay in this tree, and the one that differed most — bg-black/30
          and a shadow-xl where the others used bg-black/40 and none. One dialog now. */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setErr(null) }}
        dismissable={!busy}
        title="Tax on this order"
        actions={
          <>
            <button onClick={() => void save()} disabled={busy} className="v2-act" data-solid>{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setOpen(false); setErr(null) }} disabled={busy} className="v2-act">Cancel</button>
          </>
        }
      >
        <p className="v2-hint" style={{ marginBottom: 18 }}>
          This order is {stage}. Its tax and its invoice photo can still be corrected — the price,
          the line items and the customer cannot.
        </p>

        <div className="v2-fld">
          <label htmlFor="ode-tax">Tax (delivering to)</label>
          <span className="v2-sel">
            <select id="ode-tax" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy}>
              <option value="">No tax — nothing shown on the document</option>
              {TAX_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.region} · {c.label} {c.ratePercent}%{c.hint ? ` — ${c.hint}` : ''}
                </option>
              ))}
            </select>
          </span>
        </div>

        <label className="v2-check" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} disabled={busy} />
          <span>Provincial tax exempt (resale)<em>Asserted by you and printed as written — nothing here validates a certificate.</em></span>
        </label>
        {exempt && (
          <div className="v2-fld" style={{ marginTop: 10 }}>
            <label htmlFor="ode-note">Printed under the tax line</label>
            <input id="ode-note" value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="PST exempt — resale certificate on file" disabled={busy} />
          </div>
        )}

        {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 16 }}><p>{err}</p></div>}
      </Modal>
    </>
  )
}
