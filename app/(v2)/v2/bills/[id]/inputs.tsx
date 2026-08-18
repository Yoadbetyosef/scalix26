'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// THE TWO THINGS THE OWNER TYPES — LIFTED FROM v1, NOT REWRITTEN.
//
// `Rate` and `Charge` in app/landed-cost/[id]/page.tsx are the originals. Their bodies are copied
// character for character, because they are the only place in the application that writes
// `supplier_invoices.exchange_rate` and `landed_cost_shipments.freight_total`, and a second
// implementation of a field that gates a cost write is a second set of guards to get wrong.
//
// ── WHERE THIS IS NOT BYTE-IDENTICAL, AND WHY ───────────────────────────────────────────────────
//
//  1. `onSaved(await r.json())` → `router.refresh()`. v1's screen is a client component holding the
//     whole ShipmentDetail in state, so it adopts the PATCH response. This screen is a SERVER
//     component: there is nothing here to set. The response is discarded and the server re-reads —
//     which is the stronger of the two, because the allocation moves when a charge changes and
//     `setShipmentInputs` re-runs `reallocate()` before it answers.
//  2. Class attributes: v1's Tailwind for /v2's own.
//  3. `err` is NEW. v1 swallows a failed save — `if (r.ok)` with no else — and the input keeps the
//     typed value, so a refused PATCH looks exactly like a saved one. On the field that decides
//     whether Apply may write anything at all, that is not a carry-over worth honouring.
//  4. `field` is a union rather than `string`. Type only; the three names are the route's own.
//
// Everything else is the original: SAVE ON BLUR, no save button, no debounce; the NO-OP GUARDS that
// refuse a value the route would reject and refuse a value that has not changed; and REMOUNTING BY
// `key` from the parent rather than syncing a prop into state with an effect, which would be state
// derived from a prop and would fight the cursor mid-edit.

type ChargeField = 'freightTotal' | 'dutiesTotal' | 'otherTotal'

/**
 * The rate paid on this invoice. Seeded once from the server; a change from the server remounts it via
 * `key` rather than being re-synced with an effect.
 */
export function BillRate({ id, from, to, value, disabled }: {
  id: string; from: string; to: string; value: number | null; disabled: boolean
}) {
  const router = useRouter()
  const [v, setV] = useState(value ? String(value) : '')
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    const t = v.trim()
    const n = t ? Number(t) : null
    if (t && (!Number.isFinite(n) || (n as number) <= 0)) return
    if (n === value) return
    setErr(null)
    const r = await fetch(`/api/invoices/shipments/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRate: n }),
    })
    if (r.ok) router.refresh()
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error || 'That rate did not save.')
  }

  return (
    <label className="v2-efield">
      <span>Exchange rate</span>
      <span className="v2-bl-rate">
        <i>{`1 ${from} =`}</i>
        <input
          inputMode="decimal" value={v} placeholder="0.00" disabled={disabled}
          onChange={(e) => setV(e.target.value)} onBlur={save}
        />
        <i>{to}</i>
      </span>
      {err && <span className="v2-emsg" data-bad>{err}</span>}
    </label>
  )
}

/** One editable charge from the forwarder's bill. Always in base currency. */
export function BillCharge({ label, value, id, field, ccy, disabled }: {
  label: string; value: number; id: string; field: ChargeField; ccy: string; disabled: boolean
}) {
  const router = useRouter()
  const [v, setV] = useState(String(value || ''))
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    const n = Number(v.trim() || 0)
    if (!Number.isFinite(n) || n < 0 || n === value) return
    setErr(null)
    const r = await fetch(`/api/invoices/shipments/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: n }),
    })
    if (r.ok) router.refresh()
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error || 'That figure did not save.')
  }

  return (
    <label className="v2-efield">
      <span>{`${label} (${ccy})`}</span>
      <input
        inputMode="decimal" value={v} placeholder="0" disabled={disabled}
        onChange={(e) => setV(e.target.value)} onBlur={save}
      />
      {err && <span className="v2-emsg" data-bad>{err}</span>}
    </label>
  )
}
