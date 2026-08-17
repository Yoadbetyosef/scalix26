'use client'

import { useState } from 'react'
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

  const inp = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Edit tax
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="mt-16 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Tax on this order</h3>
        <p className="mt-1 text-xs text-gray-500">
          This order is {stage}. Its tax and its invoice photo can still be corrected — the price,
          the line items and the customer cannot.
        </p>

        <label className="mt-4 block text-xs text-gray-500">Tax (delivering to)
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={inp} disabled={busy}>
            <option value="">No tax — nothing shown on the document</option>
            {TAX_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.region} · {c.label} {c.ratePercent}%{c.hint ? ` — ${c.hint}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} disabled={busy} className="h-3.5 w-3.5 rounded border-gray-300" />
          Provincial tax exempt (resale)
        </label>
        {exempt && (
          <label className="mt-2 block text-xs text-gray-500">Printed under the tax line
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="PST exempt — resale certificate on file" className={inp} disabled={busy} />
          </label>
        )}

        {err && <p className="mt-3 text-xs text-red-600">{err}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setOpen(false); setErr(null) }} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
